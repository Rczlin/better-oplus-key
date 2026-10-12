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
