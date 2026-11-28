"""Generate report figures from the exact persisted volume and its saved geometry."""
from io import BytesIO

import nibabel as nib
import numpy as np
from PIL import Image, ImageDraw

from .volume_cpr import render_cpr
from .volume_mpr import render_mpr


def study_figures(source, mask, geometry):
    image = nib.load(source)
    candidate = next(iter(geometry.get('candidates') or []), None)
    ras = candidate.get('location_ras_mm') if candidate else None
    voxel = nib.affines.apply_affine(np.linalg.inv(image.affine), ras).round().astype(int) if ras else np.array(image.shape) // 2
    voxel = np.clip(voxel, 0, np.array(image.shape) - 1)
    figures, captions = {}, {}
    for axis in range(3):
        orientation = nib.aff2axcodes(image.affine)[axis]
        name = f'images/source_axis_{axis}.png'
        figures[name] = render_mpr(source, mask, axis=axis, index=int(voxel[axis]), window=800,
                                   level=300, opacity=.38, physical_aspect=True)
        captions[name] = (f'Source-grid axis {axis} ({orientation}), slice {voxel[axis]}. Cyan shows the predicted mask. '
                          f'Selected point RAS mm: {nib.affines.apply_affine(image.affine, voxel).round(2).tolist()}.')
    if candidate:
        path = next((item for item in geometry.get('paths', []) if item['id'] == candidate['path_id']), None)
        if path:
            name = 'images/cpr_selected_path.png'
            figures[name] = render_cpr(source, mask, path['points_ras_mm'], window=800, level=300, opacity=.38)
            captions[name] = f"{candidate['id']} / {path['id']}. Straightened CPR, {path['length_mm']:.1f} mm along the saved path."
        sections = candidate.get('cross_sections') or []
        for index, section in enumerate(sections):
            if not section.get('lumen_pixels_ij') or not section.get('grid_size'):
                continue
            size = section['grid_size']
            grid = np.zeros((size, size), dtype=np.uint8)
            i, j = np.asarray(section['lumen_pixels_ij']).T
            grid[i, j] = 255
            panel = Image.fromarray(grid).convert('RGB')
            panel = panel.resize((240, 240), Image.Resampling.NEAREST)
            step = section['step_mm']
            bar = round(5 * 240 / (size * step))
            draw = ImageDraw.Draw(panel)
            draw.line((10, 222, 10 + bar, 222), fill='#35dec9', width=3)
            draw.text((10, 206), '5 mm', fill='#35dec9')
            stream = BytesIO()
            panel.save(stream, format='PNG')
            name = f'images/lumen_section_{index}.png'
            figures[name] = stream.getvalue()
            role = ('Minimum', 'First reference', 'Second reference')[index]
            captions[name] = (f"{candidate['id']} / {candidate['path_id']}. {role} saved section. "
                              f"Sampling {step} mm, area {section['area_mm2']:.2f} mm².")
    return figures, captions


def peak_slice(heat, source):
    values, affine, _ = heat
    peak = np.unravel_index(values.argmax(), values.shape)
    native = nib.affines.apply_affine(np.linalg.inv(source.affine) @ affine, peak).round().astype(int)
    if all(0 <= index < size for index, size in zip(native, source.shape)):
        return int(native[2])
    return None


def vessel_figure(preview, geometry):
    """Render the saved viewer mesh with a deterministic oblique camera."""
    mesh = preview.get('mesh') or {}
    if not mesh.get('faces') or not mesh.get('vertices'):
        return None
    vertices = np.asarray(mesh['vertices'])
    camera = np.array([[.866, .5, 0], [-.25, .433, .866], [.433, -.75, .5]])
    view = vertices @ camera.T
    scale = 440 / max(np.ptp(view[:, 0]), np.ptp(view[:, 1]), .001)
    center = (view[:, :2].max(axis=0) + view[:, :2].min(axis=0)) / 2
    xy = (view[:, :2] - center) * [scale, -scale] + [260, 260]
    faces = np.asarray(mesh['faces'])
    panel = Image.new('RGB', (520, 520), '#111c26')
    draw = ImageDraw.Draw(panel)
    triangles = view[faces]
    normals = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    lighting = np.abs(normals[:, 2]) / np.maximum(np.linalg.norm(normals, axis=1), 1e-10)
    for index in np.argsort(triangles[:, :, 2].mean(axis=1)):
        light = lighting[index]
        draw.polygon([tuple(v) for v in xy[faces[index]]], fill=(int(24+72*light), int(95+120*light), int(121+115*light)))
    candidate = next(iter(geometry.get('candidates') or []), None)
    if candidate and candidate.get('location_ras_mm') and preview.get('world_radius_mm'):
        point = (np.asarray(candidate['location_ras_mm']) - preview['world_centre_mm']) / preview['world_radius_mm']
        px, py = ((point @ camera.T)[:2] - center) * [scale, -scale] + [260, 260]
        if 12 <= px < 496 and 12 <= py < 508:
            draw.ellipse((px-6, py-6, px+6, py+6), fill='#ffb26a', outline='white', width=1)
            draw.text((px+8, py-7), str(candidate['id']), fill='white')
    stream = BytesIO()
    panel.save(stream, format='PNG')
    return stream.getvalue()
