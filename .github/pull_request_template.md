## Outcome

Describe the observable user or maintainer outcome.

## Changes

- Describe the focused changes here.

## Verification

- [ ] `npm run check`
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets`
- [ ] `node --test scripts/verify-public-boundary.test.mjs`
- [ ] `node scripts/verify-public-boundary.mjs --tracked`

Add focused tests, manual checks, or screenshots below. Screenshots must use
synthetic data and must not expose local paths or provider-owned content.

## Public-boundary review

- [ ] Fixtures and examples are synthetic.
- [ ] No credentials, personal provider data, transcripts, private repository
      names, local paths, unredacted logs, dogfood records, or release
      infrastructure are included.
- [ ] New dependencies and assets have compatible licenses and required notices.
- [ ] Public documentation and examples do not imply access to private systems.

## Product-safety review

Check every item that applies:

- [ ] Provider-owned sessions and receipts remain authoritative.
- [ ] Dispatch still requires an exact, expiring, single-use approval.
- [ ] Ambiguous external starts fail closed and are not retried.
- [ ] Authentication and execution continue through official provider runtimes.
- [ ] Provider-specific limitations remain visible.
- [ ] Security-sensitive changes received explicit maintainer review.

If an item does not apply, say why:

## Related issue

Closes #
