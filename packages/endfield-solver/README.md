# Arr_Solver integration

Source: https://github.com/ziyanQAQ/Arr_Solver

Pinned commit: `455d7f17e06d7bb08ab7cef0f154b72b72455fd4`.

The project owner identified this as the site's own solver. No third-party UI or framework has been imported. This copy does not assign a new license to the upstream project or game data.

`upstream/` preserves the solver modules. The only source adaptation is `ship-data.mjs`: `loadShipData` accepts parsed JSON instead of reading a filesystem path. The data's local authoring path is removed. Browser builds replace the solver's explicit debug environment flags with their upstream defaults; no environment secrets enter the bundle.

`index.mjs` is the validated website boundary. Run each solve in a fresh Worker, terminate on cancel, and never persist BigInt masks as JSON. Display search status and verification separately; a successful verifier is not a proof of global optimality.
