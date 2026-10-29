# Programming to publication

1. The developer prepares a frozen source snapshot and the dated handoff described in RELEASE-HANDOFF.md.
2. The handoff identifies a frozen source revision, exact artifacts, tests, hardware observations, compatibility and rollback.
3. The release maintainer reviews that handoff, checks the snapshot for credentials/private data and required licenses, runs appropriate tests, then updates the public source, downloads, docs and site together.
4. A development source snapshot is not automatically a stable release. Create a versioned software/firmware release only when build identity, compatibility, artifacts and known limitations are documented. Do not announce the reported crackle fix as independently hardware-verified until that evidence is supplied.
5. GitHub main remains the official public branch; the working PC is not remotely editable by public visitors. Proposed community changes go through review. A website deployment does not update anyone's installed Orbit.

No physical display control is needed for a saved-screenshot or website update.
