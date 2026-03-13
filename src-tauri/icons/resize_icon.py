#!/usr/bin/env python3
from PIL import Image

# Open the original icon
img = Image.open('icon_original.png')

# Calculate 90% size (leaving 5% padding on each side)
new_size = int(512 * 0.90)  # 461 pixels

# Resize the icon content
img_resized = img.resize((new_size, new_size), Image.Resampling.LANCZOS)

# Create a new 512x512 image with transparent background
new_img = Image.new('RGBA', (512, 512), (0, 0, 0, 0))

# Calculate position to center the resized icon
position = ((512 - new_size) // 2, (512 - new_size) // 2)

# Paste the resized icon onto the center
new_img.paste(img_resized, position, img_resized)

# Save the new icon
new_img.save('icon.png', 'PNG')
print("Icon resized with 10% padding (90% content)!")
