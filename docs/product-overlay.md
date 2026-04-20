# Product Overlay Compatibility

Kōdō Code restores product-facing branding and behavior on top of the synced DPCode base without renaming every internal compatibility identifier.

These internal identifiers intentionally remain unchanged unless a dedicated migration is planned:

- `~/.dpcode` storage paths
- legacy desktop bundle ids derived from `dpcode`
- internal cache keys or protocol ids that are not user-facing

This keeps installs stable and reduces future cherry-pick friction with DPCode and T3Code while letting Kōdō-specific branding, release metadata, settings, and desktop behavior live in explicit overlay seams.
