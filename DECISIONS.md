# B1: Two-axis permission setting

- D-RN-B1-1: Project permissions are persisted with confinement and approval_mode. Global default is stored in `run_modes` table under `permissions_default`. Per-project overrides use the new columns, which are nullable; `null` implies inheritance from the global default.
- D-RN-B1-2: Legacy permissions are bridged at load time in `crates/warsha-store/src/settings.rs` to maintain compatibility with older configuration formats.
- D-RN-B1-3: RPC methods `permissions.*` are authenticated with `Session` policy for gets and `Owner` for sets.
