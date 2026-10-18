cmake_minimum_required(VERSION 3.16)
project(oplus_sidekey C)
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
enable_testing()

add_executable(test_smoke tests/test_smoke.c)
add_test(NAME smoke COMMAND test_smoke)

add_library(sidekey_fsm STATIC src/sidekey_fsm.c)
target_include_directories(sidekey_fsm PUBLIC include)
add_executable(test_fsm tests/test_fsm.c)
target_link_libraries(test_fsm PRIVATE sidekey_fsm)
add_test(NAME fsm COMMAND test_fsm)

add_library(sidekey_config STATIC src/sidekey_config.c)
target_include_directories(sidekey_config PUBLIC include)
target_include_directories(sidekey_config PRIVATE ../third_party/uthash)
target_link_libraries(sidekey_config PUBLIC sidekey_fsm)
add_executable(test_config tests/test_config.c)
target_link_libraries(test_config PRIVATE sidekey_config)
add_test(NAME config COMMAND test_config)

add_executable(test_alloc tests/test_alloc.c)
target_include_directories(test_alloc PRIVATE include ../third_party/uthash)
add_test(NAME alloc COMMAND test_alloc)

if(NOT ANDROID)
  find_package(PkgConfig QUIET)
  if(PKG_CONFIG_FOUND)
    pkg_check_modules(LIBEVDEV QUIET IMPORTED_TARGET libevdev)
  endif()
endif()

if(ANDROID OR NOT LIBEVDEV_FOUND)
  # NDK 交叉编译，或主机未安装 libevdev：直接编译 vendored libevdev 源码，不依赖 pkg-config。
  set(LIBEVDEV_SRC "${CMAKE_CURRENT_SOURCE_DIR}/../third_party/libevdev")
  add_library(libevdev_static STATIC
    ${LIBEVDEV_SRC}/libevdev/libevdev.c
    ${LIBEVDEV_SRC}/libevdev/libevdev-names.c
    ${LIBEVDEV_SRC}/libevdev/libevdev-uinput.c)
  # event-names.h 是生成文件（meson 的 configure_file 规则）：由
  # make-event-names.py 从 linux 内核头文件生成，输出到构建目录。
  set(LIBEVDEV_GEN_DIR "${CMAKE_CURRENT_BINARY_DIR}/libevdev-generated")
  file(MAKE_DIRECTORY ${LIBEVDEV_GEN_DIR})
  find_program(PYTHON3_EXE NAMES python3 python)
  if(NOT PYTHON3_EXE)
    message(FATAL_ERROR "python3 is required to generate libevdev event-names.h")
  endif()
  add_custom_command(
    OUTPUT ${LIBEVDEV_GEN_DIR}/event-names.h
    COMMAND ${PYTHON3_EXE} ${LIBEVDEV_SRC}/libevdev/make-event-names.py
            ${LIBEVDEV_SRC}/include/linux/linux/input.h
            ${LIBEVDEV_SRC}/include/linux/linux/input-event-codes.h
            > ${LIBEVDEV_GEN_DIR}/event-names.h
    DEPENDS ${LIBEVDEV_SRC}/libevdev/make-event-names.py
            ${LIBEVDEV_SRC}/include/linux/linux/input.h
            ${LIBEVDEV_SRC}/include/linux/linux/input-event-codes.h
    COMMENT "Generating event-names.h")
  add_custom_target(libevdev_gen DEPENDS ${LIBEVDEV_GEN_DIR}/event-names.h)
  add_dependencies(libevdev_static libevdev_gen)

  # 公共头文件是 libevdev/libevdev.h，因此 include 目录指向其上一级。
  target_include_directories(libevdev_static PUBLIC
    ${LIBEVDEV_SRC}
    ${LIBEVDEV_SRC}/include/linux
    ${LIBEVDEV_GEN_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/ndk-config)
  target_compile_definitions(libevdev_static PRIVATE _GNU_SOURCE=1)
  add_library(LIBEVDEV_DEP INTERFACE)
  target_link_libraries(LIBEVDEV_DEP INTERFACE libevdev_static)
else()
  add_library(LIBEVDEV_DEP INTERFACE)
  target_link_libraries(LIBEVDEV_DEP INTERFACE PkgConfig::LIBEVDEV)
endif()

add_library(sidekey_input STATIC src/sidekey_input.c)
target_include_directories(sidekey_input PUBLIC include)
target_link_libraries(sidekey_input PUBLIC sidekey_fsm LIBEVDEV_DEP)
add_executable(test_input tests/test_input.c)
target_link_libraries(test_input PRIVATE sidekey_input)
add_test(NAME input COMMAND test_input)

add_library(sidekey_runtime STATIC src/sidekey_runtime.c)
target_include_directories(sidekey_runtime PUBLIC include)
target_link_libraries(sidekey_runtime PUBLIC sidekey_config sidekey_log)
add_executable(test_runtime tests/test_runtime.c)
target_link_libraries(test_runtime PRIVATE sidekey_runtime)
add_test(NAME runtime COMMAND test_runtime)

add_library(sidekey_output STATIC src/sidekey_output.c)
target_include_directories(sidekey_output PUBLIC include)
add_executable(test_output tests/test_output.c)
target_link_libraries(test_output PRIVATE sidekey_output)
add_test(NAME output COMMAND test_output)

add_library(sidekey_notify STATIC src/sidekey_notify.c)
target_include_directories(sidekey_notify PUBLIC include)
add_executable(test_notify tests/test_notify.c)
target_link_libraries(test_notify PRIVATE sidekey_notify)
add_test(NAME notify COMMAND test_notify)

add_library(sidekey_log STATIC src/sidekey_log.c)
target_include_directories(sidekey_log PUBLIC include)
add_executable(test_log tests/test_log.c)
target_link_libraries(test_log PRIVATE sidekey_log)
add_test(NAME log COMMAND test_log)

add_library(sidekey_args STATIC src/sidekey_args.c)
target_include_directories(sidekey_args PUBLIC include)
add_executable(test_args tests/test_args.c)
target_link_libraries(test_args PRIVATE sidekey_args)
add_test(NAME args COMMAND test_args)

add_library(sidekey_scan STATIC src/sidekey_scan.c)
target_include_directories(sidekey_scan PUBLIC include)
target_link_libraries(sidekey_scan PUBLIC LIBEVDEV_DEP)
add_executable(test_scan tests/test_scan.c)
target_link_libraries(test_scan PRIVATE sidekey_scan)
add_test(NAME scan COMMAND test_scan)

add_executable(test_daemon_config tests/test_daemon_config.c)
target_link_libraries(test_daemon_config PRIVATE
  sidekey_args sidekey_config sidekey_fsm sidekey_log sidekey_output sidekey_notify
  sidekey_runtime sidekey_scan sidekey_input LIBEVDEV_DEP)
add_test(NAME daemon_config COMMAND test_daemon_config)

add_executable(test_daemon_lifecycle tests/test_daemon_lifecycle.c)
target_link_libraries(test_daemon_lifecycle PRIVATE
  sidekey_args sidekey_config sidekey_fsm sidekey_log sidekey_output sidekey_notify
  sidekey_runtime sidekey_scan sidekey_input LIBEVDEV_DEP)
add_test(NAME daemon_lifecycle COMMAND test_daemon_lifecycle)

add_executable(test_output_capture tests/test_output_capture.c)
target_link_libraries(test_output_capture PRIVATE
  sidekey_args sidekey_config sidekey_fsm sidekey_log sidekey_output sidekey_notify
  sidekey_runtime sidekey_scan sidekey_input LIBEVDEV_DEP)
add_test(NAME output_capture COMMAND test_output_capture)

add_executable(test_reload tests/test_reload.c)
target_include_directories(test_reload PRIVATE ../third_party/uthash)
target_link_libraries(test_reload PRIVATE
  sidekey_args sidekey_output sidekey_notify sidekey_runtime sidekey_scan sidekey_input LIBEVDEV_DEP)
add_test(NAME reload COMMAND test_reload)

# 守护进程可执行文件：仅在 NDK 交叉编译时生成（主机只跑单元测试）。
if(ANDROID)
  add_executable(oplus-sidekey src/main.c)
  target_link_libraries(oplus-sidekey PRIVATE
    sidekey_args sidekey_config sidekey_fsm sidekey_log sidekey_output sidekey_notify
    sidekey_runtime sidekey_scan sidekey_input LIBEVDEV_DEP)
endif()
