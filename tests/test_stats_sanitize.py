"""Tests for the stats persistence sanitizers that keep torn memory reads out of
the leaderboard: _valid_eos (drops ghost records under short/garbage keys) and
_clean_name (drops mojibake names). See the live Gorodok/Fallujah stats cleanup."""

from sqreader.stats import _clean_name, _clean_tag, _revive, _valid_eos, _vk


# --- _valid_eos ------------------------------------------------------------

def test_valid_eos_accepts_real_uuid():
    # The real server emits 36-char UUIDs (hex + dashes).
    assert _valid_eos("ddea5914-b687-4df7-b96d-2f320f7dc057")


def test_valid_eos_accepts_32_hex():
    assert _valid_eos("0123456789abcdef0123456789ABCDEF")


def test_valid_eos_rejects_short_fragments():
    # Torn OnlineUserId reads → 0-16 char junk keys (the ghost leaderboard rows).
    for bad in ("", "a", "ab", "abc", "0123456789abcdef"):
        assert not _valid_eos(bad), bad


def test_valid_eos_rejects_nonhex_and_nonstr():
    assert not _valid_eos("g" * 36)          # right length, non-hex
    assert not _valid_eos("name with spaces and stuff!!!!")
    assert not _valid_eos(None)
    assert not _valid_eos(12345678901234567890123456789012)


# --- _clean_name -----------------------------------------------------------

def test_clean_name_keeps_unicode_names():
    # Turkish / CJK real names must survive (row 2 "[鸧]" is a real clan tag).
    for ok in ("MATRİX ALİ", "MEMATİ BAŞ", "[鸧]", "Rhympex", "eko"):
        assert _clean_name(ok) == ok


def test_clean_name_rejects_control_chars():
    assert _clean_name("bad\x00name") is None
    assert _clean_name("x\x1fy") is None
    assert _clean_name("z\x7f") is None


def test_clean_name_rejects_runaway_length():
    assert _clean_name("A" * 49) is None
    assert _clean_name("A" * 48) == "A" * 48   # boundary kept


def test_clean_name_rejects_empty_and_nonstr():
    assert _clean_name("") is None
    assert _clean_name(None) is None
    assert _clean_name(42) is None


# --- _revive (RevivedPoints is the revive COUNT, 1 per revive) --------------

def test_revive_keeps_sane_integer_counts():
    for ok in (0, 1, 5, 30, 500):
        assert _revive(ok) == float(ok)


def test_revive_rejects_noninteger_torn_reads():
    # Live garbage was non-integer floats slipping past the 100k score bound.
    for bad in (16001.3046875, 6028.94140625, 482.2431640625, 2.023):
        assert _revive(bad) is None


def test_revive_rejects_out_of_range():
    assert _revive(-1) is None
    assert _revive(501) is None       # past the generous per-match ceiling
    assert _revive(100000) is None


def test_revive_rejects_nonnumeric():
    assert _revive(None) is None
    assert _revive("x") is None


# --- _vk (vehicle_kills has a MUCH lower ceiling than infantry kills) -------

def test_vk_keeps_realistic_vehicle_kills():
    for ok in (0, 1, 11, 29, 57, 150):
        assert _vk(ok) == ok


def test_vk_rejects_torn_read_junk_band():
    # Live junk was ~459/460/461 (adjacent stat fields read as a sequence) —
    # under the shared _count(5000) ceiling but impossible for vehicle kills.
    for bad in (151, 200, 460, 535, 5000):
        assert _vk(bad) is None


def test_vk_rejects_negative_and_nonnumeric():
    assert _vk(-1) is None
    assert _vk(None) is None
    assert _vk("x") is None


# --- _clean_tag (keep stylized Latin/symbol tags; drop torn-read mojibake) --
# Policy: keep symbols, box-drawing lines, CJK brackets/punctuation ("『』〖〗"),
# Greek/Cyrillic and Latin. Reject torn-read mojibake — CJK/Hangul/Kana
# ideographs, block elements, zalgo — even a genuine all-ideograph tag (accepted
# tradeoff: that garbage is far more common than a real short ideograph tag).

def test_clean_tag_keeps_legit_stylized_tags():
    for ok in ("BΛDGΞR♦", "✦ AC ✦", "TRB │ ♠", "『GM』", "〖GM〗", "8mm", "TIM"):
        assert _clean_tag(ok) == ok


def test_clean_tag_rejects_torn_read_cjk_mojibake():
    # The "Chinese-looking" leaderboard garbage: a torn/stale
    # PlayerNamePrefix read decodes as random CJK / Hangul / Kana
    # ideographs, block elements, and zalgo combining marks. Escapes keep
    # the source ASCII-safe. None is a real clan tag.
    for junk in ("银蓬祀m", "绰黑祀m",  # CJK
                 "김嗯QZ", "鸧",                    # Hangul + CJK
                 "▇▇QZ",                             # block elements
                 "アイ",                               # katakana
                 "Ä̈B"):                            # zalgo combining
        assert _clean_tag(junk) is None


def test_clean_tag_strips_surrounding_space():
    assert _clean_tag("owL | ") == "owL |"
    assert _clean_tag("  ") is None            # space-only → empty


def test_clean_tag_rejects_control_and_private_use():
    assert _clean_tag("\x10뜀") is None      # the x1184 live garbage (\x10 + Hangul)
    assert _clean_tag("\x03\x04") is None
    assert _clean_tag("옥痝") is None  # private-use-area mojibake
    assert _clean_tag("x�y") is None        # UTF-16 replacement char


def test_clean_tag_rejects_eos_id_alias():
    # A torn read aliasing onto OnlineUserId leaked a 32-hex id as the tag.
    assert _clean_tag("0002a0ebb8654b1bb0691c7f5f3c7c47") is None


def test_clean_tag_rejects_runaway_length_empty_nonstr():
    assert _clean_tag("A" * 17) is None
    assert _clean_tag("A" * 16) == "A" * 16      # boundary kept
    assert _clean_tag("") is None
    assert _clean_tag(None) is None
    assert _clean_tag(42) is None
