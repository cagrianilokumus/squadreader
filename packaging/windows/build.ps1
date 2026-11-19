<#
.SYNOPSIS
  Build the self-contained Windows package of sqreader.

.DESCRIPTION
  Produces dist\sqreader-<version>-windows-x64.zip and dist\SHA256SUMS.

  The package needs nothing installed on the target machine. It carries:
    python\     the official CPython embeddable distribution (PSF-signed,
                hash-pinned below) plus the wheels in requirements.txt
                (hash-pinned, installed with --require-hashes)
    app\        the sqreader source, precompiled, and its data\static tables
    frontend\, icons\, sqmaps\   the replay viewer and its assets
    install.ps1, sqreaderctl.ps1, uninstall.ps1, common.ps1, sqreader.cmd
    INSTALL.md, TECHNICAL-SUMMARY.md, LICENSE, NOTICE, VERSION.txt,
    MANIFEST-SHA256.txt (every file's hash, to check an unpacked copy)

  The build ends by running `version` and `selftest` with the packaged
  interpreter from the staged folder, and stops if either fails.

.PARAMETER Python
  A local CPython of the SAME minor version as the embedded one; only its
  pip is used, to resolve the wheels for win_amd64.
#>
param(
    [string]$Python = "python"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

# The embedded interpreter. Bump all three together.
$PythonVersion     = "3.13.12"
$PythonMinor       = "3.13"
$PythonEmbedSha256 = "76f238f606250c87c6beac75dccd35ee99070a13490555936abb6cb64ecce3d0"

$Repo  = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Here  = $PSScriptRoot
$m = Select-String -Path (Join-Path $Repo "sqreader\__init__.py") -Pattern '__version__ = "([^"]+)"'
$Version = $m.Matches[0].Groups[1].Value
$Name  = "sqreader-$Version-windows-x64"
$Dist  = Join-Path $Repo "dist"
$Cache = Join-Path $Dist ".cache"
$Stage = Join-Path $Dist $Name

function Say($msg) { Write-Host "[build] $msg" }

New-Item -ItemType Directory -Force -Path $Cache | Out-Null
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

# --- 1. the interpreter ---------------------------------------------------
$embedZip = Join-Path $Cache "python-$PythonVersion-embed-amd64.zip"
if (-not (Test-Path $embedZip)) {
    Say "downloading python-$PythonVersion-embed-amd64.zip"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -OutFile $embedZip `
        -Uri "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
}
$got = (Get-FileHash -Algorithm SHA256 $embedZip).Hash.ToLower()
if ($got -ne $PythonEmbedSha256) {
    throw "embeddable Python hash mismatch: $got (expected $PythonEmbedSha256)"
}
$pyDir = Join-Path $Stage "python"
Expand-Archive -Path $embedZip -DestinationPath $pyDir
foreach ($f in @("python.exe", "python313.dll")) {
    $sig = Get-AuthenticodeSignature (Join-Path $pyDir $f)
    if ($sig.Status -ne "Valid" -or $sig.SignerCertificate.Subject -notmatch "Python Software Foundation") {
        throw "$f is not validly signed by the Python Software Foundation ($($sig.Status))"
    }
}
Say "Python $PythonVersion verified (sha256 + PSF signature)"

# The ._pth file is the embedded interpreter's whole sys.path: the app,
# the bundled wheels, nothing from the machine (no PYTHONPATH, no registry).
$pth = Get-ChildItem -Path $pyDir -Filter "python*._pth" | Select-Object -First 1
Set-Content -Path $pth.FullName -Encoding Ascii -Value @(
    "python313.zip", ".", "..\app", "Lib\site-packages", "import site")

# --- 2. the wheels ----------------------------------------------------------
$site = Join-Path $pyDir "Lib\site-packages"
Say "installing pinned wheels"
& $Python -m pip install --disable-pip-version-check --no-compile `
    --require-hashes --only-binary=:all: --platform win_amd64 `
    --python-version $PythonMinor --implementation cp `
    --target $site -r (Join-Path $Here "requirements.txt")
if ($LASTEXITCODE -ne 0) { throw "pip install failed" }

# --- 3. the app and its assets ---------------------------------------------
function Copy-Tree($from, $to) {
    New-Item -ItemType Directory -Force -Path $to | Out-Null
    & robocopy $from $to /E /NFL /NDL /NJH /NJS /NP /XD __pycache__ .pytest_cache /XF *.pyc | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy $from failed ($LASTEXITCODE)" }
}
Copy-Tree (Join-Path $Repo "sqreader")      (Join-Path $Stage "app\sqreader")
Copy-Tree (Join-Path $Repo "data\static")   (Join-Path $Stage "app\data\static")
Copy-Tree (Join-Path $Repo "frontend\dist") (Join-Path $Stage "frontend\dist")
Copy-Tree (Join-Path $Repo "icons")         (Join-Path $Stage "icons")
Copy-Tree (Join-Path $Repo "sqmaps")        (Join-Path $Stage "sqmaps")
foreach ($f in @("install.ps1", "sqreaderctl.ps1", "uninstall.ps1", "common.ps1",
                 "sqreader.cmd", "INSTALL.md", "TECHNICAL-SUMMARY.md")) {
    Copy-Item (Join-Path $Here $f) $Stage
}
Copy-Item (Join-Path $Repo "LICENSE") $Stage
Copy-Item (Join-Path $Repo "NOTICE")  $Stage

$commit = "unknown"
try {
    $commit = (& git -C $Repo rev-parse HEAD 2>$null).Trim()
    if (& git -C $Repo status --porcelain 2>$null) { $commit += " (with uncommitted changes)" }
} catch { }
Set-Content -Path (Join-Path $Stage "VERSION.txt") -Encoding Ascii -Value @(
    "sqreader $Version (windows-x64)",
    "commit:  $commit",
    "python:  $PythonVersion embeddable",
    ("built:   " + (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss") + " UTC"))

# --- 4. precompile, then prove it runs ---------------------------------------
$py = Join-Path $pyDir "python.exe"
& $py -m compileall -q (Join-Path $Stage "app") | Out-Null
if ($LASTEXITCODE -ne 0) { throw "compileall failed" }

Push-Location $Stage
try {
    Say "smoke test: version"
    & $py -m sqreader.cli version
    if ($LASTEXITCODE -ne 0) { throw "packaged 'version' failed" }
    Say "smoke test: selftest"
    & $py -m sqreader.cli selftest
    if ($LASTEXITCODE -ne 0) { throw "packaged 'selftest' failed" }
} finally { Pop-Location }

# --- 5. manifest, zip, checksum -----------------------------------------------
$manifest = Join-Path $Stage "MANIFEST-SHA256.txt"
$lines = Get-ChildItem -Path $Stage -Recurse -File |
    Where-Object { $_.FullName -ne $manifest } |
    Sort-Object FullName |
    ForEach-Object {
        $rel = $_.FullName.Substring($Stage.Length + 1)
        "{0}  {1}" -f (Get-FileHash -Algorithm SHA256 $_.FullName).Hash.ToLower(), $rel
    }
Set-Content -Path $manifest -Encoding Ascii -Value $lines

$zip = Join-Path $Dist "$Name.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Say "zipping $Name.zip"
Compress-Archive -Path $Stage -DestinationPath $zip -CompressionLevel Optimal
$zipHash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
Set-Content -Path (Join-Path $Dist "SHA256SUMS") -Encoding Ascii -Value "$zipHash  $Name.zip"

$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Say "done: dist\$Name.zip ($mb MB)"
Say "sha256 $zipHash"
