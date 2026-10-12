; 사이버 홍대입구 설치 프로그램 사용자 정의 (electron-builder가 build/installer.nsh 를 자동으로 포함)

; 프로그램을 "제거"할 때 상영 영상 캐시도 지운다.
;  - 캐시: 설치 폴더 옆 "<설치 폴더>-cache" (dashboard/main.js 의 pickCacheDir 와 같은 규칙)
;  - 설치 폴더 옆에 쓸 수 없을 때 쓰던 예전 위치: %APPDATA%\cyber-hongdae\data\cache
; 업데이트·재설치 때도 기존 버전의 제거 프로그램이 실행되는데, 이때는 설치 프로그램이
; /KEEP_APP_DATA 와 --updated 를 붙여 실행하므로 그때는 캐시를 남겨 둔다.
!macro customUnInstall
  Push $R8
  Push $R9
  ${GetParameters} $R9
  ClearErrors
  ${GetOptions} $R9 "/KEEP_APP_DATA" $R8
  ${if} ${Errors}
    ${ifNot} ${isUpdated}
      DetailPrint "상영 영상 캐시 삭제: $INSTDIR-cache"
      RMDir /r "$INSTDIR-cache"
      !ifdef APP_PACKAGE_NAME
        ${if} $installMode == "all"
          SetShellVarContext current
        ${endif}
        RMDir /r "$APPDATA\${APP_PACKAGE_NAME}\data\cache"
        ${if} $installMode == "all"
          SetShellVarContext all
        ${endif}
      !endif
    ${endif}
  ${endif}
  ClearErrors
  Pop $R9
  Pop $R8
!macroend
