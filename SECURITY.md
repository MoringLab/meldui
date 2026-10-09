# Security

This release accepts declarative catalog data, not executable code. Host code and registered kits are trusted. Model output and diagnostic content are untrusted. Credentials remain in the local server; it binds to loopback. Hosts control assets, client actions and limits. Prototype keys, unknown components, impure expressions and unapproved URL schemes are rejected.

Do not expose the demo server as a public service without authentication and a host-specific session policy. Report vulnerabilities privately to the repository maintainer; a dedicated reporting address will be supplied when repository ownership is finalized. Do not disclose credentials in an issue.
