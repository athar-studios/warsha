# Terms of Service Note

## PolyForm Noncommercial 1.0.0

Warsha is licensed under the **PolyForm Noncommercial 1.0.0** license.

### Summary

| Permitted | Not Permitted |
|-----------|---------------|
| ✅ Personal use | ❌ Commercial use |
| ✅ Educational use | ❌ SaaS / hosted service |
| ✅ Research use | ❌ Reselling |
| ✅ Non-profit use | ❌ Using in paid products |
| ✅ Modification | ❌ Removing license notices |
| ✅ Distribution (non-commercial) | ❌ Using trademark without permission |

### Full License

The complete license text is the `LICENSE` file at the repository root. It is named, not linked: the book
builds only `docs/src` and copies nothing from outside it, so a relative link here would resolve on GitHub
but 404 in the served book, and no public repository URL is recorded to link instead.

### Key Points

1. **Non-commercial only** — You may not use Warsha for commercial purposes without a separate commercial license.

2. **Attribution required** — Retain all copyright, patent, trademark, and attribution notices.

3. **No warranty** — Provided "as is" without warranty of any kind.

4. **Patent grant** — Contributors grant patent licenses for their contributions.

5. **Termination** — License terminates automatically if you breach its terms.

## Commercial Licensing

For commercial use (SaaS, hosted services, paid products, enterprise deployments), contact **licensing@warsha.dev** for a commercial license.

## Trademark

"Warsha" and the ورشة logo are trademarks. You may not use them to endorse or promote derived products without permission.

## Privacy

Warsha is **local-first**:

- No telemetry or analytics
- No data sent to Warsha maintainers
- API keys stored in OS Keychain (never transmitted to us)
- All pipeline data stays on your machine
- Optional relay only forwards encrypted frames

## Security

Report security vulnerabilities to **security@warsha.dev**. We follow responsible disclosure.

## Contributing

Contributions are welcome under the same license. By contributing, you agree your contributions will be licensed under PolyForm Noncommercial 1.0.0.

## Third-Party Notices

Warsha includes third-party software. The attribution source is the `THIRD_PARTY_NOTICES.md` file at the
repository root — it records each declared component (Goose, Activepieces CE, mdBook and the reviewed
design skills), the license that governs it, and where the license text lives, plus the `Cargo.lock` /
`pnpm-lock.yaml` pointers for transitive dependencies. It is named, not linked: that file sits outside
`docs/src`, so `mdbook build` does not copy it into the served book and a relative link here would 404.