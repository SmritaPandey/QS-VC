# Release-gate exceptions (OpenVEX)

The image gate in `scripts/package-intranet-images.sh` fails on every High or
Critical finding, including findings with no fix ("wont-fix"). Remediate first
(newer base, smaller base, rebuild without the component). Use this folder only
when a finding cannot be remediated and a person has reviewed it.

- One file per image: `<image-name>.openvex.json`, where `<image-name>` is the
  image with `:` and `/` replaced by `-` (for example `qsvc-coturn-intranet`).
- Author: the reviewing person's name and email (not a tool or agent).
- Timestamp: within the last 90 days; re-review after that.
- Each statement: one vulnerability ID, `products` naming the image, status
  `not_affected` (with an allowed justification and an `impact_statement` of
  why) or `fixed`.
- `check-vex.py` enforces these rules before Grype uses the file, and the file
  is copied into the release under `vex/`.

The first time a VEX file is used, confirm in the Grype JSON that the intended
matches moved to the ignored list and nothing else did.
