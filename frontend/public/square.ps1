Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('c:\Users\Dhinesh\Documents\antigravity\billing-software\frontend\public\vm-logo.png')
$size = [math]::Max($img.Width, $img.Height)
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::Transparent)
$x = [math]::Round(($size - $img.Width) / 2)
$y = [math]::Round(($size - $img.Height) / 2)
$g.DrawImage($img, $x, $y, $img.Width, $img.Height)
$bmp.Save('c:\Users\Dhinesh\Documents\antigravity\billing-software\frontend\public\vm-logo-square.png', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
$img.Dispose()
echo "Success"
