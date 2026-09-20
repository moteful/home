@echo off
chcp 65001 >nul
setlocal
set "HERE=%~dp0"

rem ===== 自动探测可用的 node.exe（不再写死版本号）=====
set "NODE="
rem 1) 优先 .workbuddy 托管版本：按目录名降序取第一个实际存在的
for /f "delims=" %%D in ('dir /b /ad /o-n "%USERPROFILE%\.workbuddy\binaries\node\versions" 2^>nul') do (
  if not defined NODE if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\%%D\node.exe" set "NODE=%USERPROFILE%\.workbuddy\binaries\node\versions\%%D\node.exe"
)
rem 2) 回退到 PATH 里的 node
if not defined NODE for /f "delims=" %%P in ('where node 2^>nul') do (
  if not defined NODE set "NODE=%%P"
)
if not defined NODE (
  echo [错误] 未找到可用的 node.exe
  echo         请安装 Node.js，或确认该目录存在：
  echo         %%USERPROFILE%%\.workbuddy\binaries\node\versions
  pause
  exit /b 2
)

echo ============================================================
echo  Moteful 规范三关门禁
echo  　1) 下发一致性  2) 静态规范  3) 运行时断言
echo ============================================================
echo  使用 node : %NODE%
echo.

echo [1/3] 下发一致性  inject_site.mjs --check ...
"%NODE%" "%HERE%inject_site.mjs" --check
set RC1=%ERRORLEVEL%
echo.

echo [2/3] 静态规范    lint.mjs ...
"%NODE%" "%HERE%lint.mjs"
set RC2=%ERRORLEVEL%
echo.

echo [3/3] 运行时断言  assert_spec.mjs ...
"%NODE%" "%HERE%assert_spec.mjs"
set RC3=%ERRORLEVEL%
echo.

echo ============================================================
if "%RC1%"=="0" (echo  [1] 下发一致性  : PASS) else (echo  [1] 下发一致性  : FAIL)
if "%RC2%"=="0" (echo  [2] 静态规范    : PASS) else (echo  [2] 静态规范    : FAIL)
if "%RC3%"=="0" (echo  [3] 运行时断言  : PASS) else (echo  [3] 运行时断言  : FAIL)
echo ============================================================
echo.
if not "%RC1%"=="0" goto fail
if not "%RC2%"=="0" goto fail
if not "%RC3%"=="0" goto fail
echo  全部门禁 PASS
pause
exit /b 0

:fail
echo  存在失败门禁，请查看上方输出
pause
exit /b 1
