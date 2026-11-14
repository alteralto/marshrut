# Recognize every PNG page in a folder with the OCR engine built into Windows
# (Windows.Media.Ocr) and write the text to one UTF-8 file, pages separated by
# a form feed. Nothing leaves the machine and nothing has to be installed:
# the engine and the Russian language ship with Windows.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File ocr-win.ps1 -Dir <pages> -Out <file.txt> [-Lang ru]
param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Lang = 'ru'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
function Await($op, $type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($Lang))
if (-not $engine) {
  [Console]::Error.WriteLine("OCR language '$Lang' is not installed in Windows")
  exit 2
}

$sb = New-Object System.Text.StringBuilder
$pages = Get-ChildItem -LiteralPath $Dir -Filter *.png | Sort-Object Name
foreach ($page in $pages) {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($page.FullName)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  # one text line per recognized line: "left<TAB>top<TAB>height<TAB>text", so the
  # caller can rebuild paragraphs from the geometry
  foreach ($line in $result.Lines) {
    $x = [double]::MaxValue; $y = [double]::MaxValue; $h = 0.0
    foreach ($w in $line.Words) {
      if ($w.BoundingRect.X -lt $x) { $x = $w.BoundingRect.X }
      if ($w.BoundingRect.Y -lt $y) { $y = $w.BoundingRect.Y }
      if ($w.BoundingRect.Height -gt $h) { $h = $w.BoundingRect.Height }
    }
    [void]$sb.Append([math]::Round($x)).Append("`t").Append([math]::Round($y)).Append("`t").Append([math]::Round($h)).Append("`t").Append($line.Text).Append("`n")
  }
  [void]$sb.Append("`f`n")
  $bitmap.Dispose()
  $stream.Dispose()
}
[System.IO.File]::WriteAllText($Out, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("pages: " + $pages.Count)
