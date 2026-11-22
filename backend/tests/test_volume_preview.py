import nibabel as nib
import numpy as np
import pytest

from app.volume_preview import mask_preview


def test_preview_preserves_component_identity_and_orders_largest(tmp_path):
    mask = np.zeros((18, 18, 18), dtype=np.uint8)
    mask[2:8, 2:8, 2:8] = 1
    mask[13:15, 13:15, 13:15] = 1
    image = nib.Nifti1Image(mask, np.diag([.7, .8, 1.5, 1]))
    image.header.set_xyzt_units('mm')
    path = tmp_path / 'mask.nii.gz'
    nib.save(image, path)

    result = mask_preview(path)

    assert result['foreground_voxels'] == 224
    assert result['component_count'] == 2
    assert [item['foreground_voxels'] for item in result['components']] == [216, 8]
    assert result['largest_component_voxels'] == 216
    assert result['component_sizes_voxels'] == [216, 8]
    assert result['largest_component_fraction'] == pytest.approx(216 / 224)
    assert result['isolated_fragment_voxels'] == 8
    assert result['isolated_fragment_volume_mm3'] == pytest.approx(6.72)
    assert result['voxel_spacing_mm'] == [.7, .8, 1.5]
    assert result['quality_status'] == 'abstained_disconnected_prediction'
    assert result['measurement_eligible'] is False
    assert result['mesh']['vertices'] and result['mesh']['faces']
    assert max(max(face) for face in result['mesh']['faces']) < len(result['mesh']['vertices'])
    assert len(result['points']) == sum(len(item['points']) for item in result['components'])
    assert max(abs(value) for point in result['points'] for value in point) <= 1


def test_empty_preview_has_explicit_abstention_metadata(tmp_path):
    image = nib.Nifti1Image(np.zeros((3, 3, 3), dtype=np.uint8), np.eye(4))
    image.header.set_xyzt_units('mm')
    path = tmp_path / 'empty.nii.gz'
    nib.save(image, path)
    result = mask_preview(path)
    assert result['component_sizes_voxels'] == []
    assert result['largest_component_fraction'] is None
    assert result['quality_status'] == 'abstained_empty_prediction'
    assert result['measurement_eligible'] is False


def _edge_counts(faces):
    from collections import Counter
    edges = Counter()
    for a, b, c in faces:
        for edge in ((a, b), (b, c), (c, a)):
            edges[tuple(sorted(edge))] += 1
    return edges


def test_large_surface_is_coarsened_not_holed_and_tagged_by_component(tmp_path, monkeypatch):
    from app import volume_preview
    monkeypatch.setattr(volume_preview, "MAX_PREVIEW_FACES", 1500)
    mask = np.zeros((48, 48, 48), dtype=np.uint8)
    mask[6:40, 6:40, 6:40] = 1          # large block: far more than 1500 faces at full resolution
    mask[44:47, 44:47, 44:47] = 1       # small separate component
    image = nib.Nifti1Image(mask, np.diag([.5, .5, 1.0, 1]))
    image.header.set_xyzt_units('mm')
    path = tmp_path / 'mask.nii.gz'
    nib.save(image, path)

    result = volume_preview.mask_preview(path)
    mesh = result['mesh']
    assert 0 < len(mesh['faces']) <= 1500
    assert len(mesh['face_components']) == len(mesh['faces'])
    assert set(mesh['face_components']) == {1, 2}
    largest = [face for face, component in zip(mesh['faces'], mesh['face_components']) if component == 1]
    # A closed surface shares every edge between exactly two triangles: no holes from dropped faces.
    assert set(_edge_counts(largest).values()) == {2}
    assert mesh['step_voxels'] >= 2


def test_preview_is_cached_per_mask_content(tmp_path, monkeypatch):
    from app import volume_preview
    mask = np.zeros((10, 10, 10), dtype=np.uint8); mask[2:6, 2:6, 2:6] = 1
    image = nib.Nifti1Image(mask, np.eye(4)); image.header.set_xyzt_units('mm')
    path = tmp_path / 'mask.nii.gz'; nib.save(image, path)
    calls = []
    real = volume_preview.mask_preview
    monkeypatch.setattr(volume_preview, 'mask_preview', lambda p: calls.append(p) or real(p))
    first = volume_preview.cached_preview(path, tmp_path / 'cache')
    second = volume_preview.cached_preview(path, tmp_path / 'cache')
    assert first == second and len(calls) == 1
    mask[7:9, 7:9, 7:9] = 1
    image = nib.Nifti1Image(mask, np.eye(4)); image.header.set_xyzt_units('mm'); nib.save(image, path)
    assert volume_preview.cached_preview(path, tmp_path / 'cache')['component_count'] == 2 and len(calls) == 2
