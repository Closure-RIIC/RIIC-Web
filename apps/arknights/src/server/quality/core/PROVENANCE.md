# Quality core provenance

`summary.ts`, `diff.ts`, and their `types.ts` are adapted from the deployed Check service. The summary and diff source SHA256 values are respectively `622649174e32412402367a25b3576365b0305fd9b3532f02fb065da1a8fcedf9` and `c8de1ad9e0e4da7a5e828ea6d364de12f3686a28b1e82b61652087cb8911a643`.

The old public API, storage roots, automatic candidate discovery, and runner entry point are not imported. Private execution uses the website's bounded `InfraCliServeClient` with a separately pinned executable and isolated database queue.

The old runners return 143 on SIGTERM and 130 on SIGINT. Their systemd units do not classify these as successful exits. Both observed failures have status 143 and zero automatic restarts; this is consistent with a stop operation being classified as a failure, not evidence of a solver crash. The historical journal and quality archives are unavailable, so the initiator of the stop remains unknown. Existing jobs and services were not changed.
