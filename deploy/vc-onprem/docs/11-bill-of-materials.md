# Bill of materials

**ASSUMED – pending client approval**. Pilot design and configuration choices require client acceptance.

Start with the P0 inventory and package lockfiles. For each shipped image record its source digest, OS/architecture, image ID, builder, lockfile digest, license inventory, Syft CycloneDX and SPDX, and Grype output. Record model revisions, license and offline package checksums separately. CBOM must bind actual algorithms, key references and providers to the release. The image packager generates CycloneDX, SPDX, image IDs and Grype JSON when run. The source CBOM is an initial inventory. Bind its entries and deployment-specific keys and providers to exact artifacts before release. Complete release CBOM, provenance, offline mirror and reproducibility comparison remain pending. [CycloneDX CBOM](https://cyclonedx.org/capabilities/cbom/)
