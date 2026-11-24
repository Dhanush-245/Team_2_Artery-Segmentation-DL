"""Bounded point preview of the saved source-grid vessel mask."""
from threading import BoundedSemaphore

PREVIEW_SLOTS = BoundedSemaphore(1)
MAX_PREVIEW_POINTS = 16_000
MAX_PREVIEW_FACES = 20_000
MAX_MESH_STEP = 6
MAX_MESH_COMPONENTS = 64


def mask_preview(path):
    import nibabel as nib
    import numpy as np

    from .volume_inference import MAX_VOXELS

    image = nib.load(path)
    if (len(image.shape) != 3 or image.get_data_dtype() != np.dtype('uint8')
            or np.prod(image.shape) > MAX_VOXELS or image.dataobj.slope != 1 or image.dataobj.inter != 0):
        raise ValueError('Unsupported saved mask geometry')
    if not np.isfinite(image.affine).all() or image.header.get_xyzt_units()[0] != 'mm':
        raise ValueError('Saved mask has no usable spatial geometry')

    source_mask = np.asarray(image.dataobj) > 0
    count = int(np.count_nonzero(source_mask))
    if not count:
        return {'foreground_voxels': 0, 'component_count': 0, 'component_sizes_voxels': [],
                'largest_component_voxels': 0, 'largest_component_fraction': None,
                'isolated_fragment_voxels': 0, 'isolated_fragment_volume_mm3': 0,
                'voxel_spacing_mm': nib.affines.voxel_sizes(image.affine).round(6).tolist(),
                'quality_status': 'abstained_empty_prediction', 'measurement_eligible': False,
                'mesh': {'vertices': [], 'faces': [], 'face_components': [], 'step_voxels': None}, 'components': [], 'points': []}

    from scipy.ndimage import label
    labels, component_count = label(source_mask, structure=np.ones((3, 3, 3), dtype=np.uint8))
    sizes = np.bincount(labels.ravel())[1:]
    ordered = np.argsort(sizes)[::-1]

    # Use one common physical-space normalization for every component so that
    # filtering in the browser never changes their relative placement.
    occupied = np.argwhere(source_mask)
    occupied_world = nib.affines.apply_affine(image.affine, occupied)
    centre = (occupied_world.min(axis=0) + occupied_world.max(axis=0)) / 2
    radius = np.linalg.norm(occupied_world - centre, axis=1).max()
    radius = float(radius or 1)

    # Extract a closed isosurface per connected component. When the full-resolution
    # surface exceeds the preview budget, marching cubes runs on a coarser grid
    # (larger step) for every component, which keeps each surface watertight;
    # dropping triangles instead would leave holes that look like fragments.
    mesh = {'vertices': [], 'faces': [], 'face_components': [], 'step_voxels': None}
    if min(source_mask.shape) >= 2:
        from scipy.ndimage import find_objects
        from skimage.measure import marching_cubes
        boxes = find_objects(labels)
        ranked = [(rank, int(index + 1)) for rank, index in enumerate(ordered[:MAX_MESH_COMPONENTS], start=1)]

        def surfaces(step):
            parts = []
            for rank, identity in ranked:
                box = boxes[identity - 1]
                lower = np.array([item.start for item in box])
                region = labels[box] == identity
                # Pad by one step on every side and round each dimension up to a whole
                # number of steps so the sampled grid always ends on empty voxels; the
                # surface then closes on every side.
                tail = [step + (-(dim + step) % step) for dim in region.shape]
                padded = np.pad(region.astype(np.uint8), [(step, extra) for extra in tail])
                try:
                    vertices, faces, _, _ = marching_cubes(padded, level=.5, step_size=step)
                except (ValueError, RuntimeError):
                    continue  # too small to resolve at this step
                if len(faces):
                    parts.append((rank, vertices + lower - step, faces))
            return parts

        for step in range(1, MAX_MESH_STEP + 1):
            parts = surfaces(step)
            if sum(len(faces) for _, _, faces in parts) <= MAX_PREVIEW_FACES:
                break
        else:
            # Still over budget at the coarsest step: keep whole components, largest first.
            kept, total = [], 0
            for part in parts:
                if total + len(part[2]) > MAX_PREVIEW_FACES:
                    break
                kept.append(part); total += len(part[2])
            parts = kept
        all_vertices, all_faces, face_components, offset = [], [], [], 0
        for rank, vertices, faces in parts:
            world = nib.affines.apply_affine(image.affine, vertices)
            all_vertices.append(((world - centre) / radius).round(5))
            all_faces.append(faces + offset)
            face_components.extend([rank] * len(faces))
            offset += len(vertices)
        if all_faces:
            mesh = {'vertices': np.concatenate(all_vertices).tolist(),
                    'faces': np.concatenate(all_faces).astype(int).tolist(),
                    'face_components': face_components, 'step_voxels': step}

    components = []
    remaining = MAX_PREVIEW_POINTS
    remaining_voxels = count
    for rank, component_index in enumerate(ordered, start=1):
        identity = int(component_index + 1)
        voxels = np.argwhere(labels == identity)
        size = int(sizes[component_index])
        # Allocate samples proportionally while guaranteeing representation of
        # each component. Exact voxel counts remain available separately.
        slots = min(size, max(0, round(remaining * size / remaining_voxels)))
        if remaining and not slots:
            slots = 1
        if slots:
            indices = np.linspace(0, size - 1, slots, dtype=np.int64)
            world = nib.affines.apply_affine(image.affine, voxels[indices])
            points = ((world - centre) / radius).round(5).tolist()
        else:
            points = []
        components.append({'id': rank, 'foreground_voxels': size, 'points': points})
        remaining -= slots
        remaining_voxels -= size

    largest = components[0]['foreground_voxels']
    voxel_volume = float(abs(np.linalg.det(image.affine[:3, :3])))
    return {'foreground_voxels': count, 'component_count': int(component_count),
            'component_sizes_voxels': [component['foreground_voxels'] for component in components],
            'largest_component_voxels': largest,
            'largest_component_fraction': largest / count,
            'isolated_fragment_voxels': count - largest,
            'isolated_fragment_volume_mm3': (count - largest) * voxel_volume,
            'voxel_spacing_mm': nib.affines.voxel_sizes(image.affine).round(6).tolist(),
            'quality_status': 'abstained_disconnected_prediction' if component_count > 1
                              else 'research_geometry_only',
            'measurement_eligible': component_count == 1,
            'world_centre_mm': [round(float(v), 4) for v in centre], 'world_radius_mm': round(radius, 4),
            'mesh': mesh,
            'components': components,
            # Preserve the legacy field for older clients.
            'points': [point for component in components for point in component['points']]}


PREVIEW_VERSION = 'v3-world-frame'


def cached_preview(path, cache_dir):
    """Return the preview for this exact mask file, computing it at most once per content hash."""
    import hashlib
    import json
    import os
    from pathlib import Path
    digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    cache = Path(cache_dir) / f'{digest}.{PREVIEW_VERSION}.json'
    if cache.is_file():
        return json.loads(cache.read_text())
    result = mask_preview(path)
    cache.parent.mkdir(parents=True, exist_ok=True)
    temporary = cache.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, separators=(',', ':')))
    os.replace(temporary, cache)
    return result
