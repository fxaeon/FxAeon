$ErrorActionPreference = 'Stop'
$design = Join-Path $PSScriptRoot 'design'
$assets = Join-Path $PSScriptRoot 'assets'
$svg = Join-Path $design 'fxaeon-banner.svg'
$landingOut = Join-Path $assets 'fxaeon-banner.png'
$miniAppOut = Join-Path $PSScriptRoot '..\mini-app\public\landing\fxaeon-banner.png'
$edgeCandidates = @(
  (Get-Command msedge.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Microsoft\Edge\Application\msedge.exe'
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
if (-not $edgeCandidates) { throw 'Microsoft Edge is required to render the SVG social card.' }
$edge = $edgeCandidates | Select-Object -First 1
$tempOutput = Join-Path ([IO.Path]::GetTempPath()) ('fxaeon-banner-' + [guid]::NewGuid().ToString('N') + '.png')
try {
  $svgUri = ([System.Uri]$svg).AbsoluteUri
  & $edge --headless --disable-gpu --hide-scrollbars --no-first-run --window-size=1200,630 "--screenshot=$tempOutput" $svgUri | Out-Null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tempOutput)) { throw 'Edge failed to render the SVG social card.' }
  $bytes = [IO.File]::ReadAllBytes($tempOutput)
  $width = [System.Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($bytes, 16))
  $height = [System.Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($bytes, 20))
  if ($width -ne 1200 -or $height -ne 630) { throw "Rendered PNG is ${width}x${height}; expected 1200x630." }
  Copy-Item -LiteralPath $tempOutput -Destination $landingOut -Force
  Copy-Item -LiteralPath $tempOutput -Destination $miniAppOut -Force
} finally {
  Remove-Item -LiteralPath $tempOutput -Force -ErrorAction SilentlyContinue
}
