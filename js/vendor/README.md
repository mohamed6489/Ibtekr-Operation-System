`supabase.js` is `dist/umd/supabase.js` of `@supabase/supabase-js@2.118.0`, unchanged (global `supabase`).
To refresh: bump the version in package.json, `npm install`, then copy `node_modules/@supabase/supabase-js/dist/umd/supabase.js` here.

`xlsx.full.min.js` is `package/dist/xlsx.full.min.js` of SheetJS CE `0.20.3` (`XLSX.version` when the file is loaded; the `1.15.0`
in its commit title is the bundled codepage table's version), unchanged (global `XLSX`), sha256
`cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41`, from
`https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js` (npm stops at the vulnerable 0.18.5: CVE-2023-30533, CVE-2024-22363).
Fetched by `.github/workflows/vendor-fetch.yml` (run 40229718748, commit 83d6029). Loaded lazily by block 17 (Excel export and import).
To refresh: run that workflow with the new version, then update the version and sha256 here.

`html2canvas.min.js` is `package/dist/html2canvas.min.js` of `html2canvas@1.4.1`, unchanged (global `html2canvas`), sha256
`e87e550794322e574a1fda0c1549a3c70dae5a93d9113417a429016838eab8cb`, from
`https://registry.npmjs.org/html2canvas/-/html2canvas-1.4.1.tgz` (fetched with `npm pack html2canvas@1.4.1` into a scratch folder,
tarball sha1 `7cef1888311b5011d507794a066041b14669a543` = the registry's `dist.shasum`). Loaded lazily by blocks 10 and 28 (image export).
To refresh: `npm pack html2canvas@<ver>` outside the repo, check the tarball against `npm view html2canvas@<ver> dist.integrity`,
copy only `package/dist/html2canvas.min.js` here, then update the version and sha256 here.
