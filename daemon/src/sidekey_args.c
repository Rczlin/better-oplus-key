#include <string.h>
#include "sidekey_args.h"

int sidekey_parse_args(int argc, char **argv, char *dir, size_t dir_len) {
    if (argc < 2 || argv[1] == NULL) return -1;
    size_t n = strlen(argv[1]);
    if (n + 1 > dir_len) return -1;
    memcpy(dir, argv[1], n + 1);
    return 0;
}
