cmake_minimum_required(VERSION 3.16)
project(oplus_sidekey C)
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
enable_testing()

add_executable(test_smoke tests/test_smoke.c)
add_test(NAME smoke COMMAND test_smoke)
