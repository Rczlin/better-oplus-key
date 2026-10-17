# uthash

Vendored uthash v2.4.0 from commit `a49bed0b4abb7dff16c73906dcdc8a9718d582d2`.

Source: https://github.com/troydhanson/uthash/tree/a49bed0b4abb7dff16c73906dcdc8a9718d582d2

The configuration parser uses `HASH_FIND_STR`, `HASH_ADD_KEYPTR`, `HASH_DEL`
and `HASH_ITER`, with `HASH_NONFATAL_OOM=1`. A failed insertion has a null
`hh.tbl`; the temporary configuration is discarded and the active one is retained.

License: BSD, see LICENSE and the header notice.
