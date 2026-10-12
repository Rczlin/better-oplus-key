/* 最小 config.h，供 NDK 交叉编译 vendored libevdev 使用。
   meson 生成的完整版本只额外设置了 _Float* 兼容宏，且仅在 coverity 选项下启用，
   NDK 构建不需要。来源：third_party/libevdev/meson.build 第 35–36 行与第 299 行。 */
#ifndef SIDEKEY_NDK_CONFIG_H
#define SIDEKEY_NDK_CONFIG_H

#define _GNU_SOURCE 1

#endif
