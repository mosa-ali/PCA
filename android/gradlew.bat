@rem SPDX-License-Identifier: Apache-2.0
@rem Generated Gradle wrapper launcher. Do not place project logic in this file.
@if "%DEBUG%"=="" @echo off
@setlocal
set APP_HOME=%~dp0
set CLASSPATH=%APP_HOME%gradle\wrapper\gradle-wrapper.jar
if defined JAVA_HOME (
  set JAVA_EXE=%JAVA_HOME%\bin\java.exe
) else (
  set JAVA_EXE=java.exe
)
"%JAVA_EXE%" -Xmx64m -Xms64m "-Dorg.gradle.appname=gradlew" -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*
set WRAPPER_EXIT_CODE=%ERRORLEVEL%
@endlocal & exit /b %WRAPPER_EXIT_CODE%
