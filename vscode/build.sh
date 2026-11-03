#!/usr/bin/env bash
# Packages the extension as usage-meter-statusbar.vsix beside this script.
# A .vsix is a zip: a content-types file, a manifest, and the extension folder.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
version="$(node -p "require('$here/package.json').version")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir "$work/extension"
cp "$here/package.json" "$here/extension.js" "$here/icon.png" "$work/extension/"

cat > "$work/[Content_Types].xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".png" ContentType="image/png"/><Default Extension=".vsixmanifest" ContentType="text/xml"/></Types>
EOF

cat > "$work/extension.vsixmanifest" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="usage-meter-statusbar" Version="$version" Publisher="azoni" />
    <DisplayName>Claude usage meter</DisplayName>
    <Description xml:space="preserve">Shows your Claude plan usage (5-hour and weekly) in the status bar.</Description>
    <Categories>Other</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.80.0" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>
EOF

rm -f "$here/usage-meter-statusbar.vsix"
(cd "$work" && zip -q -X -r "$here/usage-meter-statusbar.vsix" "[Content_Types].xml" extension.vsixmanifest extension)
echo "Built $here/usage-meter-statusbar.vsix ($version)"
