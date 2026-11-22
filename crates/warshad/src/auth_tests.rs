use super::*;
use chrono::Utc;

/// A pairing the daemon holds.
fn pairing(device_id: &str, secret: &str) -> PhonePairing {
    PhonePairing::new(device_id, secret, 1_700_000_000)
}

/// A device id string a paired phone can be named by.
fn uuid() -> String {
    DeviceId::new().to_string()
}

fn sessions() -> Sessions {
    Sessions::new("owner-token", DeviceId::new())
}

#[test]
fn the_owner_token_authenticates_the_owner_and_nothing_else_does() {
    let sessions = sessions();
    let local = sessions.local_device();

    let owner = sessions
        .resolve("owner-token", &[])
        .expect("the daemon's own token is the owner");
    assert_eq!(owner.role(), ActorRole::Owner);
    assert_eq!(owner.device_id(), Some(local));

    assert!(sessions.resolve("wrong", &[]).is_none());
    assert!(sessions.resolve("", &[]).is_none());
    assert!(sessions.resolve("   ", &[]).is_none());
    // A near miss is refused, and refused the same way as a stranger.
    assert!(sessions.resolve("owner-toke", &[]).is_none());
}

#[test]
fn a_pairing_secret_authenticates_its_device_and_a_revoked_one_does_not() {
    let phone = uuid();
    let sessions = sessions();
    let pairings = vec![pairing(&phone, "s3cr3t")];

    let actor = sessions
        .resolve("s3cr3t", &pairings)
        .expect("the pairing's secret authenticates");
    assert_eq!(actor.role(), ActorRole::Paired);
    assert_eq!(
        actor.device_id().map(|id| id.to_string()),
        Some(phone.clone()),
        "the device id bound the actor is the pairing's, not a caller's"
    );

    let mut revoked = pairing(&phone, "s3cr3t");
    revoked.revoked = true;
    assert!(
        sessions.resolve("s3cr3t", &[revoked]).is_none(),
        "a revoked pairing still opened a session"
    );
    assert!(sessions.resolve("nope", &pairings).is_none());
}

#[test]
fn the_owner_credential_wins_over_a_pairing_holding_the_same_secret() {
    // A pairing created with the daemon's own token must not downgrade the owner
    // to a phone: the owner check comes first and is the higher authority.
    let sessions = Sessions::new("shared", DeviceId::new());
    let pairings = vec![pairing(&uuid(), "shared")];
    let actor = sessions.resolve("shared", &pairings).expect("a session");
    assert_eq!(actor.role(), ActorRole::Owner);
}

#[test]
fn a_paired_device_with_a_non_device_id_has_no_approver_to_record() {
    let actor = Actor::paired(&pairing("not-a-uuid", "secret"));
    assert_eq!(actor.role(), ActorRole::Paired);
    assert_eq!(
        actor.device_id(),
        None,
        "a pairing id that is not a device id was treated as one"
    );
}

#[test]
fn a_role_covers_only_what_it_carries() {
    assert!(ActorRole::Owner.covers(ActorRole::Owner));
    assert!(ActorRole::Owner.covers(ActorRole::Paired));
    assert!(ActorRole::Paired.covers(ActorRole::Paired));
    assert!(
        !ActorRole::Paired.covers(ActorRole::Owner),
        "a paired device could claim the owner's authority"
    );
}

#[test]
fn every_privileged_mutation_names_the_owner_and_a_session_does_not_reach_it() {
    // The audit's H-04 list, read straight off the table.
    for method in [
        "providers.add",
        "providers.remove",
        "budget.set",
        "devices.pair",
        "devices.pair-start",
        "devices.revoke",
        "pairing.create",
        "pairing.revoke",
        "runmode.set",
        "backend.set",
        "roles.set",
        "process.spawn",
        "mcp.connect",
        "mcp.call",
        "mcp.approvals.list",
        "mcp.approvals.allow_once",
        "preview.start",
        "routines.run_now",
        "handoff.apply",
    ] {
        let entry = policy_of(method).unwrap_or_else(|| panic!("{method} has no policy"));
        assert_eq!(entry.policy, Owner, "{method} is not owner-gated");
    }

    // R-BRIDGE-B3a: the one-shot grant is a permission write with a shorter life, so
    // it is priced exactly like the permanent one — Owner, and the same tier.
    let allow_once = policy_of("mcp.approvals.allow_once").expect("an approval policy");
    let permanent = policy_of("mcp.permissions.set").expect("a permission policy");
    assert_eq!(allow_once.policy, Owner);
    assert_eq!(
        allow_once.tier, permanent.tier,
        "the one-shot grant was priced differently from the permanent grant"
    );
    assert_eq!(allow_once.tier, Spend);

    // Reading the queue is the table read's gate: Owner, Standard, and never the
    // Spend tier the write spends.
    let approvals_list = policy_of("mcp.approvals.list").expect("an approval policy");
    assert_eq!(approvals_list.policy, Owner);
    assert_eq!(approvals_list.tier, Standard);
    assert_ne!(approvals_list.tier, allow_once.tier);

    // A gate decision needs a verified session and is measured in the strictest
    // tier after pairing: it is how a phone acts, and it records who acted.
    for method in ["gates.approve", "gates.reject", "gates.changes"] {
        let entry = policy_of(method).expect("a gate policy");
        assert_eq!(entry.policy, Session);
        assert_eq!(entry.tier, Auth);
    }

    // The gates queue read (#25) goes both ways on the same table: a paired
    // device and the owner may both read the queue a phone is asked to decide
    // (`Session` is the role that covers both), and an unauthenticated caller
    // reaches nothing because `authorize` refuses before any role is compared
    // (asserted as behaviour in the daemon's tests). It is deliberately not on
    // the `Auth` tier the three decisions above spend — `SimpleMode` polls this
    // path, and a credential-path ceiling would starve the inbox it feeds.
    let queue = policy_of("gates.list").expect("the gates queue read has a policy");
    assert_eq!(queue.policy, Session);
    assert_eq!(queue.tier, Standard);
    assert_ne!(
        queue.tier,
        policy_of("gates.approve").expect("a gate policy").tier,
        "the queue read was pulled onto the decision path's ceiling"
    );

    // Pairing and spend are the strictest ceilings, as the audit requires.
    assert_eq!(policy_of("pairing.create").expect("policy").tier, Pairing);
    assert_eq!(policy_of("devices.pair").expect("policy").tier, Pairing);
    // Audit H2: the redeeming half is owner-only (the CLI presents the owner
    // token), so a paired device cannot enrol a second device. The tier stays
    // `Pairing`; only the required role changed.
    assert_eq!(policy_of("devices.pair").expect("policy").policy, Owner);
    assert_eq!(
        policy_of("devices.pair-start")
            .expect("the pairing minter has a policy")
            .policy,
        Owner
    );
    // The minting half of the pairing path is measured on the same ceiling as the
    // redeeming half — and the brief's own hazard, a paired phone creating its own
    // credential, is what the `Owner` policy above (asserted in the list walk) refuses.
    assert_eq!(
        policy_of("devices.pair-start")
            .expect("the pairing minter has a policy")
            .tier,
        Pairing
    );
    assert_eq!(policy_of("agent.turn").expect("policy").tier, Spend);
    assert_eq!(policy_of("runs.start").expect("policy").tier, Spend);
    assert_eq!(policy_of("process.spawn").expect("policy").tier, Spend);
    assert!(
        policy_of("nowhere").is_none(),
        "an unknown method was policy'd"
    );
}

#[test]
fn the_strictest_ceilings_are_on_credentials_and_spend() {
    let config = RateLimitConfig::default();
    let auth = config.auth.quota();
    let pairing = config.pairing.quota();
    let spend = config.spend.quota();
    let standard = config.standard.quota();

    // Per authenticated caller, the strictest limits sit on pairing, then spend
    // and authentication, and only then on ordinary traffic.
    assert!(
        pairing.sustained < auth.sustained,
        "pairing is not the strictest"
    );
    assert!(
        auth.sustained < standard.sustained,
        "auth is looser than standard"
    );
    assert!(
        spend.sustained < standard.sustained,
        "spend is looser than standard"
    );
    assert!(pairing.burst < standard.burst);
    assert!(auth.burst < standard.burst);
}

#[test]
fn a_caller_past_a_ceiling_is_measured_per_identity_and_per_tier() {
    let config = RateLimitConfig {
        pairing: QuotaConfig::per_minute(2, 2),
        ..RateLimitConfig::default()
    };
    let governor = RateGovernor::new(&config);
    let phone = uuid();

    assert!(governor.check(Tier::Pairing, &phone).is_allowed());
    assert!(governor.check(Tier::Pairing, &phone).is_allowed());
    let refused = governor.check(Tier::Pairing, &phone);
    assert!(
        !refused.is_allowed(),
        "a device past its pairing ceiling was served"
    );
    assert!(refused.retry_after_secs() >= 1);

    // Another device is not refused for this one's attempts, and the same device
    // is not refused in another tier for this tier's traffic.
    assert!(governor.check(Tier::Pairing, &uuid()).is_allowed());
    assert!(governor.check(Tier::Standard, &phone).is_allowed());
}

#[test]
fn the_transport_ceiling_is_the_widest_and_is_measured_before_a_credential() {
    let config = RateLimitConfig::default();
    let governor = RateGovernor::new(&config);
    assert!(config.transport.sustained > config.standard.sustained);
    assert!(governor
        .transport()
        .check(&"anonymous".to_string())
        .is_allowed());
}

#[test]
fn a_command_is_allowed_only_by_the_policy_and_no_shell_syntax_passes() {
    let policy = ProcessPolicy::from_config(&[], Path::new("/var/lib/warsha"));

    // The default list admits build tools and refuses the shells that would make
    // the list a formality.
    assert!(policy.check_command("npm").is_ok());
    // Relative paths containing a separator are refused by both policies
    assert!(policy.check_command("./npm").is_err());
    assert!(
        policy.check_command("NPM.CMD").is_ok(),
        "a case-insensitive program name was not matched"
    );
    assert!(
        policy.check_command("sh").is_err(),
        "a shell was admitted by default"
    );
    assert!(
        policy.check_command("cmd").is_err(),
        "a shell was admitted by default"
    );
    assert!(policy.check_command("bash").is_err());
    assert!(policy.check_command("rm").is_err());
    assert!(policy.check_command("").is_err());
    assert!(policy.check_command("   ").is_err());

    // Shell syntax in a program name is refused whatever the list says.
    let with_shell = ProcessPolicy::from_config(&["sh".to_string()], Path::new("/var/lib/warsha"));
    assert!(
        with_shell.check_command("sh").is_ok(),
        "an owner-added command was not honoured"
    );
    assert!(
        with_shell.check_command("sh; rm -rf /").is_err(),
        "shell syntax passed as a program"
    );
    assert!(with_shell.check_command("sh|whoami").is_err());
    assert!(with_shell.check_command("`sh`").is_err());

    // Nothing on the wire can widen the list: only the configuration names it.
    let narrow = ProcessPolicy::from_config(&["cargo".to_string()], Path::new("/var/lib/warsha"));
    assert!(narrow.check_command("cargo").is_ok());
    assert!(
        narrow.check_command("npm").is_err(),
        "the default list leaked into a configured one"
    );
}

#[test]
fn a_path_inside_the_daemon_s_own_data_dir_is_in_scope() {
    let policy = ProcessPolicy::from_config(&["npm".to_string()], Path::new("/var/lib/warsha"));

    assert!(policy
        .check_command("/var/lib/warsha/workspace/tools/migrate")
        .is_ok());
    assert!(
        policy.check_command("/usr/local/bin/migrate").is_err(),
        "an arbitrary absolute path was read as project scope"
    );
    assert!(policy.check_command("../../../usr/bin/migrate").is_err());
}

/// Audit N-2: the scope test is made on resolved paths, so neither a `..` nor a
/// symlink inside the data directory can hand a program outside it the exemption.
///
/// Everything here runs against a real, existing directory tree: the finding's case
/// is the one where the *written* path still starts with the data directory, and an
/// `expect` that only passes because the filesystem was never consulted would not
/// have caught it.
#[test]
fn an_absolute_path_that_climbs_out_of_the_data_dir_is_not_in_scope() {
    let dir = crate::test_util::fresh_tempdir();
    let data_dir = dir.path().join("warsha");
    std::fs::create_dir_all(data_dir.join("workspace")).expect("the data directory is made");
    let inside = data_dir.join("workspace").join("migrate");
    std::fs::write(&inside, b"tool").expect("the tool is written");

    let policy = ProcessPolicy::from_config(&["npm".to_string()], &data_dir);

    // The exemption the finding does not change: a program the daemon built in its
    // own workspace, named by an absolute path, is still in scope.
    assert!(policy.check_command(&inside.to_string_lossy()).is_ok());

    // The regression itself, spelled exactly as the re-audit spells it:
    // `<data_dir>/../../program` starts with `<data_dir>` component for component
    // and lands two directories up.
    let escaped = format!("{}/../../program", data_dir.display());
    let error = policy
        .check_command(&escaped)
        .expect_err("a traversal path was read as project scope");
    assert!(
        error.contains("`..`"),
        "the traversal was refused for some other reason: {error}"
    );

    // One level is enough to leave, and it is refused for the same reason rather
    // than by luck: `<data_dir>/../<sibling>/tool` is not the daemon's.
    let sibling = format!("{}/../sibling/tool", data_dir.display());
    assert!(policy.check_command(&sibling).is_err());

    // A `..` that stays inside after collapsing is still a traversal, and is
    // refused rather than reasoned about: the daemon's scope is a directory the
    // caller names, not a path expression it gets to resolve.
    let round_trip = format!("{}/workspace/../workspace/migrate", data_dir.display());
    assert!(policy.check_command(&round_trip).is_err());

    // Relative forms climb too, and are refused on the same rule rather than by the
    // accident of a program name: `../npm` is a path out of the workspace, and the
    // list admitting `npm` is not a licence to reach it from anywhere.
    assert!(policy.check_command("../npm").is_err());
    assert!(policy
        .check_command("node_modules/.bin/../evilmock")
        .is_err());

    // An absolute path to a program the *list* admits is admitted by the list, not
    // by the scope test — which is the difference between the two checks, and the
    // reason a caller outside the data directory still cannot name an unlisted
    // program.
    let elsewhere = data_dir.parent().expect("the parent exists").join("npm");
    assert!(
        policy.check_command(&elsewhere.to_string_lossy()).is_ok(),
        "an allowed program named by an absolute path outside the data directory was refused by the list"
    );
    let elsewhere_unlisted = data_dir
        .parent()
        .expect("the parent exists")
        .join("migrate");
    assert!(policy
        .check_command(&elsewhere_unlisted.to_string_lossy())
        .is_err());
}

/// A symlink placed inside the data directory is what its target is, not what its
/// name says — so the target's location decides, and a target outside is out of
/// scope (audit N-2, the same hole reached without writing `..`).
#[cfg(unix)]
#[test]
fn a_symlink_inside_the_data_dir_reaches_only_what_is_inside_it() {
    use std::os::unix::fs::symlink;

    let dir = crate::test_util::fresh_tempdir();
    let data_dir = dir.path().join("warsha");
    let outside = dir.path().join("elsewhere");
    std::fs::create_dir_all(&data_dir).expect("the data directory is made");
    std::fs::create_dir_all(&outside).expect("the other directory is made");

    let outside_tool = outside.join("evil");
    std::fs::write(&outside_tool, b"tool").expect("the outside tool is written");
    symlink(&outside_tool, data_dir.join("link")).expect("the symlink is made");

    let policy = ProcessPolicy::from_config(&["npm".to_string()], &data_dir);
    let through_link = data_dir.join("link");
    let error = policy
        .check_command(&through_link.to_string_lossy())
        .expect_err("a symlink out of the data directory was read as project scope");
    assert!(
        error.contains("link"),
        "the refusal did not name the program: {error}"
    );

    // And the honest case still works: a link to something the daemon really does
    // own inside its data directory is in scope.
    let inside_tool = data_dir.join("migrate");
    std::fs::write(&inside_tool, b"tool").expect("the inside tool is written");
    let inside_link = data_dir.join("good-link");
    symlink(&inside_tool, &inside_link).expect("the inside symlink is made");
    assert!(policy.check_command(&inside_link.to_string_lossy()).is_ok());
}

/// The scope test is a comparison of directories, not of strings: a sibling whose
/// name happens to begin with the data directory's name is a different directory.
///
/// Pinned at the key level because this is the rule a future refactor to
/// `str::starts_with` would break silently on every platform at once, and the
/// version of it that was measured on Windows (CI run 41752421903) was the *other*
/// failure: a path spelled without a drive prefix never reached the comparison at
/// all.
#[test]
fn the_scope_test_compares_components_and_never_a_string_prefix() {
    let data_dir = Path::new("/var/lib/warsha");

    // In scope: the directory itself, anything under it at any depth, and the
    // spellings of those that differ only in separators the parser collapses.
    for candidate in [
        "/var/lib/warsha",
        "/var/lib/warsha/",
        "/var/lib/warsha/workspace/tools/migrate",
        "/var/lib/warsha//workspace//migrate",
        "/var/lib/warsha/./workspace/migrate",
    ] {
        assert!(
            scope_contains(data_dir, Path::new(candidate)),
            "`{candidate}` is inside the data directory"
        );
    }

    // Out of scope: a sibling that shares the name's prefix, a shorter path, a
    // different root, and a component that merely begins with the same letters.
    for candidate in [
        "/var/lib/warsha-evil/tool",
        "/var/lib/warsh/tool",
        "/var/lib",
        "/usr/local/bin/migrate",
        "warsha/workspace/migrate",
    ] {
        assert!(
            !scope_contains(data_dir, Path::new(candidate)),
            "`{candidate}` was read as inside the data directory"
        );
    }
}

/// A program the daemon built in its own workspace is in scope whether or not the
/// file exists yet, and a sibling directory of the data directory never is — the
/// same rules as above, run against a real tree so the resolved branch of
/// [`resolves_inside`] is the one under test.
#[test]
fn a_sibling_of_the_data_dir_is_out_of_scope_in_a_real_tree() {
    let dir = crate::test_util::fresh_tempdir();
    let data_dir = dir.path().join("warsha");
    std::fs::create_dir_all(data_dir.join("workspace")).expect("the workspace is made");

    let policy = ProcessPolicy::from_config(&["npm".to_string()], &data_dir);
    let spelled = |path: &str| format!("{}/{}", data_dir.display(), path);

    // The data directory itself, and a nested path that does not exist yet: a run
    // that has not built its tool still owns the place it would build it in.
    assert!(policy.check_command(&data_dir.to_string_lossy()).is_ok());
    assert!(policy
        .check_command(&spelled("workspace/tools/build-not-built-yet"))
        .is_ok());
    assert!(
        policy
            .check_command(&format!("{}/", data_dir.display()))
            .is_ok(),
        "a trailing separator moved the boundary"
    );

    // The sibling a string prefix admits: `<data_dir>-evil/tool`.
    let sibling = format!("{}-evil/tool", data_dir.display());
    let error = policy
        .check_command(&sibling)
        .expect_err("a sibling of the data directory was read as project scope");
    assert!(
        error.contains("tool"),
        "the refusal did not name the program: {error}"
    );

    // And a `..` traversal, refused before the comparison rather than resolved by it.
    let escaped = format!("{}/../sibling/tool", data_dir.display());
    assert!(policy.check_command(&escaped).is_err());
}

/// A data directory that names no root grants no scope at all.
///
/// Reduced to components, `""` is a prefix of every path on the machine, and a
/// relative one is a prefix of whatever the current directory happens to be: reading
/// either as the daemon's scope would make the whole filesystem in scope. The
/// daemon's own data directory is always rooted, so this is a misconfiguration, and
/// a misconfiguration is refused rather than honoured.
#[test]
fn an_unrooted_data_dir_grants_no_scope() {
    for data_dir in ["", "warsha", "target/debug", "."] {
        let policy = ProcessPolicy::from_config(&["npm".to_string()], Path::new(data_dir));
        assert!(
            policy.check_command("/usr/local/bin/migrate").is_err(),
            "a data directory spelled `{data_dir}` let an absolute path outside it into scope"
        );
        assert!(
            policy.check_command("npm").is_ok(),
            "the allow-list stopped working for a data directory spelled `{data_dir}`"
        );
    }
}

/// The two Windows spellings that would otherwise answer "outside" about a directory
/// the daemon does own are folded onto one key: the `\\?\` verbatim marker
/// `std::fs::canonicalize` returns, and ASCII case.
///
/// Run on every host, from UTF-16 units, so the arithmetic that only Windows calls
/// is still measured here rather than trusted.
#[test]
fn the_windows_spelling_of_a_component_reduces_to_the_plain_form() {
    fn a_component(text: &str) -> Component<'_> {
        Component::Normal(std::ffi::OsStr::new(text))
    }
    fn fold(component: Component<'_>, text: &str) -> String {
        let wide: Vec<u16> = text.encode_utf16().collect();
        String::from_utf16(&fold_verbatim_and_case(component, &wide))
            .expect("the fold keeps valid UTF-16")
    }

    // The text a prefix component carries, in each of the two forms the same drive
    // or share is spelled in.
    assert_eq!(fold(a_component(r"\\?\C:"), r"\\?\C:"), "c:");
    assert_eq!(fold(a_component("C:"), "C:"), "c:");
    assert_eq!(
        fold(
            a_component(r"\\?\UNC\SERVER\share"),
            r"\\?\UNC\SERVER\share"
        ),
        r"\\server\share"
    );
    assert_eq!(
        fold(a_component(r"\\SERVER\share"), r"\\SERVER\share"),
        r"\\server\share"
    );

    // Only ASCII case, and only the verbatim marker: nothing else is invented,
    // because a comparison wider than the filesystem is the error this cannot make.
    assert_eq!(fold(a_component("PROGRA~1"), "PROGRA~1"), "progra~1");
    assert_eq!(fold(a_component("DATA-evil"), "DATA-evil"), "data-evil");
    assert_eq!(fold(a_component("warsha."), "warsha."), "warsha.");
    assert_ne!(
        fold(a_component("ÄÖÜ"), "ÄÖÜ"),
        fold(a_component("äöü"), "äöü"),
        "non-ASCII case was folded"
    );

    // The root is one key whichever separator typed it, and a name that merely
    // begins with a separator is still a name and not a root.
    assert_eq!(fold(Component::RootDir, r"\"), r"\");
    assert_eq!(fold(Component::RootDir, "/"), r"\");
    assert_ne!(
        fold(a_component(r"\warsha"), r"\warsha"),
        fold(a_component("warsha"), "warsha")
    );
}

/// Off Windows, the case of a component is part of the directory's name, and a `\`
/// is an ordinary character rather than a separator. Case only decides anything at
/// the boundary and above it: what a path descends *into* below the data directory
/// is the daemon's scope whatever it is spelled like, because the boundary component
/// is still the data directory.
#[cfg(not(windows))]
#[test]
fn case_is_part_of_a_directory_name_off_windows() {
    let dir = crate::test_util::fresh_tempdir();
    let data_dir = dir.path().join("warsha");
    std::fs::create_dir_all(data_dir.join("workspace")).expect("the workspace is made");
    let policy = ProcessPolicy::from_config(&["npm".to_string()], &data_dir);

    assert!(policy
        .check_command(&format!("{}/workspace/migrate", data_dir.display()))
        .is_ok());
    assert!(
        policy
            .check_command(&format!("{}/WORKSPACE/MIGRATE", data_dir.display()))
            .is_ok(),
        "a name below the boundary was treated as a different directory"
    );

    // The boundary component itself, spelled another way, is another directory: the
    // sibling `/tmp/x/WARSHA/workspace/migrate` is not `/tmp/x/warsha`.
    assert!(policy
        .check_command(&format!(
            "{}/WARSHA/workspace/migrate",
            dir.path().display()
        ))
        .is_err());
    // A `\` is an ordinary character in a Unix name, never a separator.
    assert!(policy
        .check_command(&format!(r"{}\workspace", data_dir.display()))
        .is_err());
}

/// On Windows, the boundary component is read case-insensitively, and both
/// separators mean the same thing: the same directory is one directory however the
/// caller spells it, and a sibling is still a sibling in every spelling.
#[cfg(windows)]
#[test]
fn case_is_not_part_of_a_directory_name_on_windows() {
    let dir = crate::test_util::fresh_tempdir();
    let data_dir = dir.path().join("warsha");
    std::fs::create_dir_all(data_dir.join("workspace")).expect("the workspace is made");
    let policy = ProcessPolicy::from_config(&["npm".to_string()], &data_dir);
    let parent = dir.path().display().to_string();

    assert!(
        policy
            .check_command(&format!(r"{}\WARSHA\workspace\migrate", parent))
            .is_ok(),
        "the same directory, shouted, was read as another one"
    );
    assert!(
        policy
            .check_command(&format!(
                r"{}/warsha/tools/not-built-yet",
                parent.replace('\\', "/")
            ))
            .is_ok(),
        "a `/`-rooted spelling of an unbuilt tool was read as another directory"
    );
    // A sibling that differs by more than case stays outside.
    assert!(policy
        .check_command(&format!(r"{}\WARSHA-EVIL\workspace\migrate", parent))
        .is_err());
}

/// On Windows, the scope test is reached by the spellings `is_absolute` used to
/// refuse: a rooted path with no drive prefix, in either separator, in either case,
/// and in the verbatim form a resolved path arrives in.
#[cfg(windows)]
#[test]
fn a_rooted_path_without_a_drive_prefix_is_in_scope_on_windows() {
    // The exact shape CI run 41752421903 measured: a POSIX-spelled data directory
    // and a program under it. `Path::is_absolute` calls it relative — no drive
    // prefix — and the exemption used to stop there.
    let policy = ProcessPolicy::from_config(&["npm".to_string()], Path::new("/var/lib/warsha"));
    assert!(
        policy
            .check_command("/var/lib/warsha/workspace/tools/migrate")
            .is_ok(),
        "a rooted path with no drive prefix was refused the scope exemption"
    );
    assert!(policy.check_command("/var/lib/warsha-evil/tool").is_err());

    let backslash =
        ProcessPolicy::from_config(&["npm".to_string()], Path::new(r"\warsha-scope-boundary"));
    assert!(backslash
        .check_command(r"\warsha-scope-boundary\workspace\migrate")
        .is_ok());
    assert!(backslash
        .check_command(r"\warsha-scope-boundary-evil\migrate")
        .is_err());

    // A drive-relative path (`C:foo`) is rooted nowhere: it names a directory under
    // the current directory on drive C, so it is not the daemon's scope and only the
    // allow-list decides it.
    assert!(backslash
        .check_command(r"C:warsha-scope-boundary\migrate")
        .is_err());
    // A relative path is refused the exemption for the same reason.
    assert!(backslash
        .check_command(r"warsha-scope-boundary\migrate")
        .is_err());
}

/// On Windows, the boundary is the same directory under every spelling the OS
/// accepts for it — and still refuses the sibling under all of them.
#[cfg(windows)]
#[test]
fn a_verbatim_or_mixed_case_form_of_the_data_dir_is_in_scope_on_windows() {
    let dir = crate::test_util::fresh_tempdir();
    let data_dir = dir.path().join("warsha");
    std::fs::create_dir_all(data_dir.join("workspace")).expect("the workspace is made");
    let inside = data_dir.join("workspace").join("migrate");
    std::fs::write(&inside, b"tool").expect("the tool is written");
    let policy = ProcessPolicy::from_config(&["npm".to_string()], &data_dir);
    let plain = inside.to_string_lossy().into_owned();

    for (shape, candidate) in [
        // What std::fs::canonicalize hands back for this very file.
        ("verbatim", format!(r"\\?\{plain}")),
        // NTFS names are case-insensitive: the same directory, shouted.
        ("shouted", plain.to_uppercase()),
        // `/` is a separator for the Windows parser too.
        ("forward", plain.replace('\\', "/")),
        // Both at once, the way a path copied out of a build log looks.
        ("mixed", plain.replace('\\', "/").to_uppercase()),
        // The same tool named by a directory that does not exist yet: the branch
        // that never reaches the filesystem, so it never gets a resolved case or a
        // resolved prefix to lean on either.
        (
            "unbuilt",
            format!(r"{}\TOOLS\NOT-BUILT-YET", data_dir.display()).to_uppercase(),
        ),
    ] {
        assert!(
            policy.check_command(&candidate).is_ok(),
            "a {shape} spelling of a program inside the data directory was refused: {candidate}"
        );
    }

    for (shape, candidate) in [
        (
            "verbatim sibling",
            format!(r"\\?\{}-evil\tool", data_dir.display()),
        ),
        (
            "shouted sibling",
            format!(r"{}-EVIL\tool", data_dir.display()),
        ),
        (
            "forward sibling",
            format!(
                r"{}/tool",
                format!(r"{}-evil", data_dir.display()).replace('\\', "/")
            ),
        ),
        // A sibling that shares only the beginning of a component's letters.
        (
            "shorter-name sibling",
            format!(r"{}sh/tool", data_dir.display()),
        ),
    ] {
        assert!(
            policy.check_command(&candidate).is_err(),
            "a {shape} of a path outside the data directory was read as in scope: {candidate}"
        );
    }
}

#[test]
fn an_environment_variable_that_hijacks_execution_is_refused() {
    let policy = ProcessPolicy::from_config(&[], Path::new("/var/lib/warsha"));

    for key in [
        "PATH",
        "LD_PRELOAD",
        "DYLD_INSERT_LIBRARIES",
        "NODE_OPTIONS",
        "RUSTC_WRAPPER",
        "path",
    ] {
        assert!(
            policy.check_env(key).is_err(),
            "`{key}` was handed to a child process"
        );
    }
    for key in ["PORT", "NODE_ENV", "WARSHA_PROJECT", "RUST_LOG"] {
        assert!(policy.check_env(key).is_ok(), "`{key}` was refused");
    }
}

#[test]
fn a_transport_is_restricted_to_tls_or_loopback() {
    let policy = ProcessPolicy::from_config(&[], Path::new("/var/lib/warsha"));

    assert!(policy
        .check_transport_url("https://mcp.example/mcp")
        .is_ok());
    assert!(policy.check_transport_url("wss://mcp.example/mcp").is_ok());
    assert!(policy
        .check_transport_url("http://127.0.0.1:9000/mcp")
        .is_ok());
    assert!(policy
        .check_transport_url("http://localhost:9000/mcp")
        .is_ok());
    assert!(policy
        .check_transport_url("ws://localhost:9000/mcp")
        .is_ok());

    assert!(policy
        .check_transport_url("http://169.254.169.254/latest")
        .is_err());
    assert!(policy
        .check_transport_url("http://evil.example/mcp")
        .is_err());
    assert!(policy.check_transport_url("file:///etc/passwd").is_err());
    assert!(policy.check_transport_url("/etc/passwd").is_err());
    // The host that is dialled is what comes after the last `@`, so a URL that
    // puts a loopback address in its credentials is not a loopback endpoint.
    assert!(policy
        .check_transport_url("http://127.0.0.1@evil.example/mcp")
        .is_err());
    assert!(policy
        .check_transport_url("http://user@127.0.0.1:9/mcp")
        .is_ok());
    // A host that merely starts with "127." is not loopback, and an IPv6
    // loopback literal is bracketed.
    assert!(policy
        .check_transport_url("http://127.example.com/mcp")
        .is_err());
    assert!(policy.check_transport_url("http://[::1]:9000/mcp").is_ok());
}

#[test]
fn a_program_name_is_the_last_segment_without_an_extension() {
    assert_eq!(program_name("npm"), "npm");
    assert_eq!(program_name("./npm"), "npm");
    assert_eq!(program_name("/usr/local/bin/vite"), "vite");
    assert_eq!(program_name("C:\\Program Files\\nodejs\\npm.cmd"), "npm");
    assert_eq!(program_name("node.EXE"), "node");
    assert_eq!(program_name("  git  "), "git");
}

#[test]
fn an_expired_pairing_is_not_a_session() {
    // The store's own liveness rule is what the session check uses, so a phone the
    // owner revoked stops being an approver on its next request.
    let phone = uuid();
    let mut revoked = pairing(&phone, "secret");
    revoked.revoked = true;
    assert!(!revoked.is_active_at(1_700_000_000));
    assert_eq!(revoked.device_id, phone);
    let active = pairing(&phone, "secret");
    assert!(active.is_active_at(1_700_000_000));
    assert!(active.created_at <= Utc::now().timestamp() as u64);
}

/// Audit H1 / test 2: the session check is judged at an instant, so an expired
/// pairing authenticates nothing at that instant, a live one still does, and the
/// owner credential is unchanged by either.
#[test]
fn sessions_resolve_refuses_an_expired_pairing_at_that_instant() {
    let phone = uuid();
    let live_secret = "live-secret";
    let expired_secret = "expired-secret";
    let now = 1_800_000_000;
    let pairings = vec![
        PhonePairing::new_with_expiry(&phone, live_secret, now - 60, Some(now + 540)),
        PhonePairing::new_with_expiry(&phone, expired_secret, now - 660, Some(now - 60)),
    ];
    let sessions = Sessions::new("owner-token", DeviceId::new());

    let live = sessions
        .resolve_at(live_secret, &pairings, now)
        .expect("a live pairing did not resolve");
    assert_eq!(live.role(), ActorRole::Paired);

    assert!(
        sessions
            .resolve_at(expired_secret, &pairings, now)
            .is_none(),
        "an expired pairing resolved a session"
    );
    // At one second before its deadline the same secret still works, so the
    // refusal is the clock and not the record.
    assert!(sessions
        .resolve_at(expired_secret, &pairings, now - 61)
        .is_some());

    // The owner token is not a pairing: it resolves the owner before any
    // pairing is considered, expired or not.
    let owner = sessions
        .resolve_at("owner-token", &pairings, now)
        .expect("the owner token stopped resolving");
    assert_eq!(owner.role(), ActorRole::Owner);
}

#[test]
fn the_rpc_refusal_codes_are_distinct_from_the_servers_generic_error() {
    use rpc_codes::*;
    let codes = [
        UNAUTHENTICATED,
        FORBIDDEN,
        IDENTITY_MISMATCH,
        RATE_LIMITED,
        POLICY_REFUSED,
    ];
    for code in codes {
        assert!(
            (-32099..-32000).contains(&code),
            "{code} is not in the JSON-RPC server-error range"
        );
        assert_ne!(code, -32000, "a refusal reused the generic server error");
    }
    assert_eq!(
        codes.iter().collect::<std::collections::HashSet<_>>().len(),
        5
    );
}
