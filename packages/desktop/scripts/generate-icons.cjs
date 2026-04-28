const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, '../public/icons/logo.svg');
const iconsDir = path.join(__dirname, '../src-tauri/icons');

// Read SVG - keep original black (#1d1d1c) and orange (#fd7104) colors
const svgContent = fs.readFileSync(svgPath, 'utf-8');

// Create PNG variants
const sizes = [32, 64, 128, 256, 512];

async function generateIcons() {
  const svgBuffer = Buffer.from(svgContent);

  // Generate PNGs - use contain to keep aspect ratio and show full graphic
  for (const size of sizes) {
    await sharp(svgBuffer)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 }  // transparent background
      })
      .png()
      .toFile(path.join(iconsDir, `${size}x${size}.png`));
    console.log(`Generated ${size}x${size}.png`);
  }

  // 128x128@2x = 256px
  await sharp(svgBuffer)
    .resize(256, 256, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    })
    .png()
    .toFile(path.join(iconsDir, '128x128@2x.png'));
  console.log('Generated 128x128@2x.png');

  // Generate ICO (use 256x256 as base)
  const icoBuffer = await sharp(svgBuffer)
    .resize(256, 256, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    })
    .png()
    .toBuffer();

  // Create a simple ICO file (single 256x256 PNG)
  // ICO format: header + directory entry + PNG data
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0); // Reserved
  icoHeader.writeUInt16LE(1, 2); // Type: 1 = ICO
  icoHeader.writeUInt16LE(1, 4); // Number of images

  const dirEntry = Buffer.alloc(16);
  dirEntry.writeUInt8(0, 0);     // Width (0 = 256)
  dirEntry.writeUInt8(0, 1);     // Height (0 = 256)
  dirEntry.writeUInt8(0, 2);     // Color palette
  dirEntry.writeUInt8(0, 3);     // Reserved
  dirEntry.writeUInt16LE(1, 4);  // Color planes
  dirEntry.writeUInt16LE(32, 6); // Bits per pixel
  dirEntry.writeUInt32LE(icoBuffer.length, 8);  // Image size
  dirEntry.writeUInt32LE(22, 12); // Offset to image data (6 + 16)

  const icoFile = Buffer.concat([icoHeader, dirEntry, icoBuffer]);
  fs.writeFileSync(path.join(iconsDir, 'icon.ico'), icoFile);
  console.log('Generated icon.ico');

  // Also update icon.png for Windows store
  await sharp(svgBuffer)
    .resize(256, 256, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    })
    .png()
    .toFile(path.join(iconsDir, 'icon.png'));
  console.log('Generated icon.png');
}

generateIcons().catch(console.error);
