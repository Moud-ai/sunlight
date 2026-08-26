cmake_minimum_required(VERSION 3.13)
project(sunlight_accel)

set(CMAKE_CXX_STANDARD 17)

# Source files
set(SOURCES
    src/main/cpp/accel_manager.cpp
    src/main/cpp/accel_jni.cpp
)

# Create shared library
add_library(sunlight_accel SHARED ${SOURCES})

# Include directories
target_include_directories(sunlight_accel PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp
)

# Import NDK's built-in cpufeatures library
include(AndroidNdkModules)
android_ndk_import_module_cpufeatures()

# Find required packages
find_library(log-lib log)
find_library(dl-lib dl)

# Link libraries
target_link_libraries(sunlight_accel
    ${log-lib}
    ${dl-lib}
    cpufeatures
)

# Enable NEON for ARM64
if(ANDROID_ABI STREQUAL "arm64-v8a")
    target_compile_options(sunlight_accel PRIVATE -march=armv8-a+simd)
endif()

# Optimization flags
target_compile_options(sunlight_accel PRIVATE
    -O2
    -Wall
    -Wextra
    -Wno-unused-parameter
)
