"""Tests for color_map module."""
import pytest
from app.color_map import (
    ORGAN_COLOR_MAP,
    ORGAN_CATEGORIES,
    PRELOAD_ORGANS,
    get_organ_info,
    get_organ_color_normalized,
    get_all_organ_names,
    get_organs_by_category,
    is_preload_organ,
)


class TestOrganColorMap:
    """Test the organ color map data structure."""

    def test_has_117_entries(self):
        assert len(ORGAN_COLOR_MAP) == 117

    def test_label_ids_are_1_to_117(self):
        expected = set(range(1, 118))
        assert set(ORGAN_COLOR_MAP.keys()) == expected

    def test_every_entry_has_required_keys(self):
        for lid, info in ORGAN_COLOR_MAP.items():
            assert "name" in info, f"Label {lid} missing 'name'"
            assert "color" in info, f"Label {lid} missing 'color'"
            assert "category" in info, f"Label {lid} missing 'category'"

    def test_every_color_is_valid_rgb(self):
        for lid, info in ORGAN_COLOR_MAP.items():
            color = info["color"]
            assert len(color) == 3, f"Label {lid} color has {len(color)} values"
            for c in color:
                assert 0 <= c <= 255, f"Label {lid} color value {c} out of range"

    def test_every_category_is_valid(self):
        valid = set(ORGAN_CATEGORIES.keys())
        for lid, info in ORGAN_COLOR_MAP.items():
            assert info["category"] in valid, f"Label {lid} has invalid category '{info['category']}'"

    def test_no_duplicate_names(self):
        names = [info["name"] for info in ORGAN_COLOR_MAP.values()]
        assert len(names) == len(set(names)), "Duplicate organ names found"

    def test_known_organ_colors(self):
        """Verify specific organs match 3D Slicer expected colors."""
        # Liver should be brownish-red
        assert ORGAN_COLOR_MAP[5]["name"] == "liver"
        assert ORGAN_COLOR_MAP[5]["color"] == [221, 130, 101]

        # Spleen should be purple-ish
        assert ORGAN_COLOR_MAP[1]["name"] == "spleen"
        assert ORGAN_COLOR_MAP[1]["color"] == [157, 108, 162]

        # Aorta should be red (artery)
        assert ORGAN_COLOR_MAP[52]["name"] == "aorta"
        assert ORGAN_COLOR_MAP[52]["color"] == [224, 97, 76]

        # IVC should be blue (vein)
        assert ORGAN_COLOR_MAP[63]["name"] == "inferior_vena_cava"
        assert ORGAN_COLOR_MAP[63]["color"] == [0, 151, 206]

        # Vertebrae should be yellow-tan (bone)
        assert ORGAN_COLOR_MAP[27]["name"] == "vertebrae_L5"
        assert ORGAN_COLOR_MAP[27]["color"] == [241, 214, 145]


class TestGetOrganInfo:
    def test_valid_label(self):
        info = get_organ_info(5)
        assert info is not None
        assert info["name"] == "liver"

    def test_invalid_label(self):
        assert get_organ_info(0) is None
        assert get_organ_info(999) is None


class TestGetOrganColorNormalized:
    def test_returns_normalized_floats(self):
        color = get_organ_color_normalized(5)
        assert color is not None
        assert len(color) == 3
        for c in color:
            assert 0.0 <= c <= 1.0

    def test_specific_normalization(self):
        # Liver: [221, 130, 101] -> [221/255, 130/255, 101/255]
        color = get_organ_color_normalized(5)
        assert abs(color[0] - 221 / 255) < 1e-6
        assert abs(color[1] - 130 / 255) < 1e-6
        assert abs(color[2] - 101 / 255) < 1e-6

    def test_invalid_label(self):
        assert get_organ_color_normalized(0) is None


class TestGetAllOrganNames:
    def test_returns_117_names(self):
        names = get_all_organ_names()
        assert len(names) == 117

    def test_contains_known_organs(self):
        names = get_all_organ_names()
        assert "liver" in names
        assert "spleen" in names
        assert "aorta" in names
        assert "heart" in names


class TestGetOrgansByCategory:
    def test_bones_category(self):
        bones = get_organs_by_category("bones")
        assert len(bones) > 0
        for info in bones.values():
            assert info["category"] == "bones"

    def test_vessels_category(self):
        vessels = get_organs_by_category("vessels")
        assert len(vessels) > 0
        assert all(info["category"] == "vessels" for info in vessels.values())

    def test_empty_category(self):
        result = get_organs_by_category("nonexistent")
        assert result == {}


class TestIsPreloadOrgan:
    def test_liver_is_preload(self):
        assert is_preload_organ("liver") is True

    def test_kidneys_are_preload(self):
        assert is_preload_organ("kidney_left") is True
        assert is_preload_organ("kidney_right") is True

    def test_minor_organ_not_preload(self):
        assert is_preload_organ("adrenal_gland_left") is False

    def test_preload_set_not_empty(self):
        assert len(PRELOAD_ORGANS) > 0
