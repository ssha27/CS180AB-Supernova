"""
TotalSegmentator organ-to-color mapping matching 3D Slicer GenericAnatomyColors.

Each entry maps a TotalSegmentator label ID to:
  - name: organ/structure name
  - color: [R, G, B] matching 3D Slicer defaults (0-255)
  - category: grouping for UI display
"""

ORGAN_CATEGORIES = {
    "organs": "Organs",
    "bones": "Bones",
    "muscles": "Muscles",
    "vessels": "Vessels",
    "other": "Other",
}

# Label ID -> { name, color [R,G,B], category }
# Colors sourced from 3D Slicer GenericAnatomyColors and TotalSegmentator defaults
ORGAN_COLOR_MAP: dict[int, dict] = {
    1:   {"name": "spleen",                        "color": [157, 108, 162], "category": "organs"},
    2:   {"name": "kidney_right",                   "color": [185, 102,  83], "category": "organs"},
    3:   {"name": "kidney_left",                    "color": [185, 102,  83], "category": "organs"},
    4:   {"name": "gallbladder",                    "color": [  0, 151,  83], "category": "organs"},
    5:   {"name": "liver",                          "color": [221, 130, 101], "category": "organs"},
    6:   {"name": "stomach",                        "color": [205, 179, 139], "category": "organs"},
    7:   {"name": "pancreas",                       "color": [249, 180, 111], "category": "organs"},
    8:   {"name": "adrenal_gland_right",            "color": [249, 205,  20], "category": "organs"},
    9:   {"name": "adrenal_gland_left",             "color": [249, 205,  20], "category": "organs"},
    10:  {"name": "lung_upper_lobe_left",           "color": [197, 165, 145], "category": "organs"},
    11:  {"name": "lung_lower_lobe_left",           "color": [197, 165, 145], "category": "organs"},
    12:  {"name": "lung_upper_lobe_right",          "color": [197, 165, 145], "category": "organs"},
    13:  {"name": "lung_middle_lobe_right",         "color": [197, 165, 145], "category": "organs"},
    14:  {"name": "lung_lower_lobe_right",          "color": [197, 165, 145], "category": "organs"},
    15:  {"name": "esophagus",                      "color": [211, 171, 143], "category": "organs"},
    16:  {"name": "trachea",                        "color": [182, 228, 255], "category": "organs"},
    17:  {"name": "thyroid_gland",                  "color": [185,  57, 128], "category": "organs"},
    18:  {"name": "small_bowel",                    "color": [205, 167, 142], "category": "organs"},
    19:  {"name": "duodenum",                       "color": [205, 167, 142], "category": "organs"},
    20:  {"name": "colon",                          "color": [200, 159, 140], "category": "organs"},
    21:  {"name": "urinary_bladder",                "color": [251, 222,   0], "category": "organs"},
    22:  {"name": "prostate",                       "color": [230, 159, 140], "category": "organs"},
    23:  {"name": "kidney_cyst_left",               "color": [205, 202,  83], "category": "organs"},
    24:  {"name": "kidney_cyst_right",              "color": [205, 202,  83], "category": "organs"},
    # --- Bones ---
    25:  {"name": "sacrum",                         "color": [241, 214, 145], "category": "bones"},
    26:  {"name": "vertebrae_S1",                   "color": [241, 214, 145], "category": "bones"},
    27:  {"name": "vertebrae_L5",                   "color": [241, 214, 145], "category": "bones"},
    28:  {"name": "vertebrae_L4",                   "color": [241, 214, 145], "category": "bones"},
    29:  {"name": "vertebrae_L3",                   "color": [241, 214, 145], "category": "bones"},
    30:  {"name": "vertebrae_L2",                   "color": [241, 214, 145], "category": "bones"},
    31:  {"name": "vertebrae_L1",                   "color": [241, 214, 145], "category": "bones"},
    32:  {"name": "vertebrae_T12",                  "color": [241, 214, 145], "category": "bones"},
    33:  {"name": "vertebrae_T11",                  "color": [241, 214, 145], "category": "bones"},
    34:  {"name": "vertebrae_T10",                  "color": [241, 214, 145], "category": "bones"},
    35:  {"name": "vertebrae_T9",                   "color": [241, 214, 145], "category": "bones"},
    36:  {"name": "vertebrae_T8",                   "color": [241, 214, 145], "category": "bones"},
    37:  {"name": "vertebrae_T7",                   "color": [241, 214, 145], "category": "bones"},
    38:  {"name": "vertebrae_T6",                   "color": [241, 214, 145], "category": "bones"},
    39:  {"name": "vertebrae_T5",                   "color": [241, 214, 145], "category": "bones"},
    40:  {"name": "vertebrae_T4",                   "color": [241, 214, 145], "category": "bones"},
    41:  {"name": "vertebrae_T3",                   "color": [241, 214, 145], "category": "bones"},
    42:  {"name": "vertebrae_T2",                   "color": [241, 214, 145], "category": "bones"},
    43:  {"name": "vertebrae_T1",                   "color": [241, 214, 145], "category": "bones"},
    44:  {"name": "vertebrae_C7",                   "color": [241, 214, 145], "category": "bones"},
    45:  {"name": "vertebrae_C6",                   "color": [241, 214, 145], "category": "bones"},
    46:  {"name": "vertebrae_C5",                   "color": [241, 214, 145], "category": "bones"},
    47:  {"name": "vertebrae_C4",                   "color": [241, 214, 145], "category": "bones"},
    48:  {"name": "vertebrae_C3",                   "color": [241, 214, 145], "category": "bones"},
    49:  {"name": "vertebrae_C2",                   "color": [241, 214, 145], "category": "bones"},
    50:  {"name": "vertebrae_C1",                   "color": [241, 214, 145], "category": "bones"},
    # --- Organs (heart, vessels) ---
    51:  {"name": "heart",                          "color": [206,  40,  57], "category": "organs"},
    # --- Vessels ---
    52:  {"name": "aorta",                          "color": [224,  97,  76], "category": "vessels"},
    53:  {"name": "pulmonary_vein",                 "color": [  0, 151, 206], "category": "vessels"},
    54:  {"name": "brachiocephalic_trunk",          "color": [224,  97,  76], "category": "vessels"},
    55:  {"name": "subclavian_artery_right",        "color": [224,  97,  76], "category": "vessels"},
    56:  {"name": "subclavian_artery_left",         "color": [224,  97,  76], "category": "vessels"},
    57:  {"name": "common_carotid_artery_right",    "color": [224,  97,  76], "category": "vessels"},
    58:  {"name": "common_carotid_artery_left",     "color": [224,  97,  76], "category": "vessels"},
    59:  {"name": "brachiocephalic_vein_left",      "color": [  0, 151, 206], "category": "vessels"},
    60:  {"name": "brachiocephalic_vein_right",     "color": [  0, 151, 206], "category": "vessels"},
    61:  {"name": "atrial_appendage_left",          "color": [206,  40,  57], "category": "organs"},
    62:  {"name": "superior_vena_cava",             "color": [  0, 151, 206], "category": "vessels"},
    63:  {"name": "inferior_vena_cava",             "color": [  0, 151, 206], "category": "vessels"},
    64:  {"name": "portal_vein_and_splenic_vein",   "color": [  0, 151, 206], "category": "vessels"},
    65:  {"name": "iliac_artery_left",              "color": [224,  97,  76], "category": "vessels"},
    66:  {"name": "iliac_artery_right",             "color": [224,  97,  76], "category": "vessels"},
    67:  {"name": "iliac_vena_left",                "color": [  0, 151, 206], "category": "vessels"},
    68:  {"name": "iliac_vena_right",               "color": [  0, 151, 206], "category": "vessels"},
    # --- Bones (limbs, pelvis) ---
    69:  {"name": "humerus_left",                   "color": [241, 214, 145], "category": "bones"},
    70:  {"name": "humerus_right",                  "color": [241, 214, 145], "category": "bones"},
    71:  {"name": "scapula_left",                   "color": [241, 214, 145], "category": "bones"},
    72:  {"name": "scapula_right",                  "color": [241, 214, 145], "category": "bones"},
    73:  {"name": "clavicula_left",                 "color": [241, 214, 145], "category": "bones"},
    74:  {"name": "clavicula_right",                "color": [241, 214, 145], "category": "bones"},
    75:  {"name": "femur_left",                     "color": [241, 214, 145], "category": "bones"},
    76:  {"name": "femur_right",                    "color": [241, 214, 145], "category": "bones"},
    77:  {"name": "hip_left",                       "color": [241, 214, 145], "category": "bones"},
    78:  {"name": "hip_right",                      "color": [241, 214, 145], "category": "bones"},
    # --- Other ---
    79:  {"name": "spinal_cord",                    "color": [244, 214,  49], "category": "other"},
    # --- Muscles ---
    80:  {"name": "gluteus_maximus_left",           "color": [192, 104,  88], "category": "muscles"},
    81:  {"name": "gluteus_maximus_right",          "color": [192, 104,  88], "category": "muscles"},
    82:  {"name": "gluteus_medius_left",            "color": [192, 104,  88], "category": "muscles"},
    83:  {"name": "gluteus_medius_right",           "color": [192, 104,  88], "category": "muscles"},
    84:  {"name": "gluteus_minimus_left",           "color": [192, 104,  88], "category": "muscles"},
    85:  {"name": "gluteus_minimus_right",          "color": [192, 104,  88], "category": "muscles"},
    86:  {"name": "autochthon_left",                "color": [192, 104,  88], "category": "muscles"},
    87:  {"name": "autochthon_right",               "color": [192, 104,  88], "category": "muscles"},
    88:  {"name": "iliopsoas_left",                 "color": [192, 104,  88], "category": "muscles"},
    89:  {"name": "iliopsoas_right",                "color": [192, 104,  88], "category": "muscles"},
    # --- Organs (brain, skull) ---
    90:  {"name": "brain",                          "color": [250, 250, 225], "category": "organs"},
    91:  {"name": "skull",                          "color": [241, 214, 145], "category": "bones"},
    # --- Bones (ribs) ---
    92:  {"name": "rib_left_1",                     "color": [241, 214, 145], "category": "bones"},
    93:  {"name": "rib_left_2",                     "color": [241, 214, 145], "category": "bones"},
    94:  {"name": "rib_left_3",                     "color": [241, 214, 145], "category": "bones"},
    95:  {"name": "rib_left_4",                     "color": [241, 214, 145], "category": "bones"},
    96:  {"name": "rib_left_5",                     "color": [241, 214, 145], "category": "bones"},
    97:  {"name": "rib_left_6",                     "color": [241, 214, 145], "category": "bones"},
    98:  {"name": "rib_left_7",                     "color": [241, 214, 145], "category": "bones"},
    99:  {"name": "rib_left_8",                     "color": [241, 214, 145], "category": "bones"},
    100: {"name": "rib_left_9",                     "color": [241, 214, 145], "category": "bones"},
    101: {"name": "rib_left_10",                    "color": [241, 214, 145], "category": "bones"},
    102: {"name": "rib_left_11",                    "color": [241, 214, 145], "category": "bones"},
    103: {"name": "rib_left_12",                    "color": [241, 214, 145], "category": "bones"},
    104: {"name": "rib_right_1",                    "color": [241, 214, 145], "category": "bones"},
    105: {"name": "rib_right_2",                    "color": [241, 214, 145], "category": "bones"},
    106: {"name": "rib_right_3",                    "color": [241, 214, 145], "category": "bones"},
    107: {"name": "rib_right_4",                    "color": [241, 214, 145], "category": "bones"},
    108: {"name": "rib_right_5",                    "color": [241, 214, 145], "category": "bones"},
    109: {"name": "rib_right_6",                    "color": [241, 214, 145], "category": "bones"},
    110: {"name": "rib_right_7",                    "color": [241, 214, 145], "category": "bones"},
    111: {"name": "rib_right_8",                    "color": [241, 214, 145], "category": "bones"},
    112: {"name": "rib_right_9",                    "color": [241, 214, 145], "category": "bones"},
    113: {"name": "rib_right_10",                   "color": [241, 214, 145], "category": "bones"},
    114: {"name": "rib_right_11",                   "color": [241, 214, 145], "category": "bones"},
    115: {"name": "rib_right_12",                   "color": [241, 214, 145], "category": "bones"},
    116: {"name": "sternum",                        "color": [241, 214, 145], "category": "bones"},
    117: {"name": "costal_cartilages",              "color": [241, 214, 145], "category": "bones"},
}

# Priority organs to pre-load in the viewer (lazy-load the rest)
PRELOAD_ORGANS = {
    "liver", "spleen", "kidney_left", "kidney_right",
    "heart", "aorta", "stomach", "pancreas",
    "sacrum", "vertebrae_L1", "vertebrae_L2", "vertebrae_L3",
    "vertebrae_L4", "vertebrae_L5", "vertebrae_T12",
    "hip_left", "hip_right",
    "rib_left_1", "rib_left_2", "rib_left_3", "rib_left_4",
    "rib_left_5", "rib_left_6", "rib_left_7", "rib_left_8",
    "rib_right_1", "rib_right_2", "rib_right_3", "rib_right_4",
    "rib_right_5", "rib_right_6", "rib_right_7", "rib_right_8",
    "sternum", "costal_cartilages",
}


def get_organ_info(label_id: int) -> dict | None:
    """Get organ info (name, color, category) for a given label ID."""
    return ORGAN_COLOR_MAP.get(label_id)


def get_organ_color_normalized(label_id: int) -> list[float] | None:
    """Get organ color as normalized [0-1] floats for rendering."""
    info = ORGAN_COLOR_MAP.get(label_id)
    if info is None:
        return None
    return [c / 255.0 for c in info["color"]]


def get_all_organ_names() -> list[str]:
    """Get list of all organ names."""
    return [info["name"] for info in ORGAN_COLOR_MAP.values()]


def get_organs_by_category(category: str) -> dict[int, dict]:
    """Get all organs in a specific category."""
    return {
        lid: info for lid, info in ORGAN_COLOR_MAP.items()
        if info["category"] == category
    }


def is_preload_organ(name: str) -> bool:
    """Check if an organ should be pre-loaded in the viewer."""
    return name in PRELOAD_ORGANS
