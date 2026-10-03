# Orca Custom

[Orca](https://github.com/stablyai/orca)의 커스텀 배포판입니다. 오케스트레이션 현황 패널, 클라우드 스킬 공유, 독립적인 Python 자동 업데이터를 포함합니다. 공식 Orca 팀의 배포판은 아닙니다.

## 설치

[Releases](https://github.com/geunyoung0120/dsm-mafia-custom-orca/releases/latest)에서 내 컴퓨터에 맞는 ZIP을 받아 **전체 압축을 해제**한 뒤 설치 파일을 실행합니다. 최초 릴리스가 없다면 [Actions](https://github.com/geunyoung0120/dsm-mafia-custom-orca/actions)에서 빌드 상태를 확인하세요.

| 컴퓨터              | ZIP 이름 끝부분    | 설치 파일                     |
| ------------------- | ------------------ | ----------------------------- |
| macOS Apple Silicon | `darwin-arm64.zip` | `Install Orca Custom.command` |
| macOS Intel         | `darwin-x64.zip`   | `Install Orca Custom.command` |
| Windows x64         | `win32-x64.zip`    | `Install Orca Custom.cmd`     |
| Linux x64           | `linux-x64.zip`    | `sh install-orca-custom.sh`   |

Python은 설치 파일에 포함됩니다. 별도 Python·Node 설치나 AI 에이전트 실행은 필요하지 않습니다. Linux는 systemd 사용자 세션과 그래픽 데스크톱이 필요하며 알림에 `notify-send`를 사용합니다.

현재 배포물에는 Apple 공증 또는 Windows 배포자 인증서가 없습니다. OS가 최초 실행을 차단하면 출처를 확인하고 OS의 실행 허용 절차를 거쳐야 할 수 있습니다. 관리 기기에서는 관리자 정책을 따릅니다.

설치 후 macOS는 `~/Applications/Orca Custom.app`, Windows는 시작 메뉴의 **Orca Custom**, Linux는 앱 메뉴에서 실행합니다. 공식 Orca와 사용자 데이터 폴더를 분리하며 기존 설정을 자동으로 가져오지 않습니다.

## 자동 업데이트

1. 이 저장소의 `main`에 소스를 올리면 GitHub Actions가 OS별 앱과 Python 업데이터를 만듭니다.
2. 네 가지 빌드와 검증이 모두 성공하면 하나의 버전으로 공개합니다.
3. 각 PC의 Python이 로그인된 동안 10분마다 **이 저장소의 최신 공개 릴리스**를 확인합니다.
4. 해당 OS의 파일을 받아 해시와 전체 앱 파일 목록을 검증합니다.
5. 앱이 실행 중이면 종료 안내 알림을 보냅니다. 작업을 저장하고 앱을 완전히 종료하세요.
6. 준비 직후 보조 프로세스가 앱 종료를 기다립니다. OS의 종료 알림을 받으면 바로 교체·검증하고 완료 알림을 보냅니다. 1분 확인 시점까지 기다리지 않습니다. 완료 후 다시 실행하세요.

원본 Orca 업데이트가 곧바로 전달되지는 않습니다. 관리자가 원본 변경을 커스텀 소스에 반영하고 이 저장소에 올린 뒤 배포 검증까지 통과해야 전달됩니다. HTML 스크래핑 대신 GitHub API로 버전을 확인합니다.

검증 실패 시 이전 앱으로 복구하며 같은 버전의 자동 재시도는 중지합니다. 알림은 OS 권한·방해금지 설정에 따라 표시되지 않을 수 있으므로 설치 기록도 제공합니다.

일시적인 네트워크 오류는 다음 확인 주기에 다시 시도합니다. 설치가 끝나면 다운로드·압축 해제 임시 파일을 정리하고, 앱 백업과 현재·직전 업데이터만 유지합니다.

## 설치 기록과 제어

| OS      | 관리 폴더                                              |
| ------- | ------------------------------------------------------ |
| macOS   | `~/Library/Application Support/Orca Custom Manager`    |
| Windows | `%LOCALAPPDATA%/OrcaCustomManager`                     |
| Linux   | `${XDG_DATA_HOME:-~/.local/share}/orca-custom-manager` |

`current.json`은 설치 버전, `status.json`은 마지막 설치 상태, `failure.json`·`last-error.json`은 실패 사유입니다. `previous-app`에는 직전 앱이 남습니다. 프로젝트와 대화 데이터는 앱 교체 대상이 아닙니다.

Windows의 명령 결과는 관리 폴더의 `command-result.json`에 기록됩니다. 예약 실행 시 콘솔 창을 띄우지 않습니다.

관리 폴더의 `OrcaCustomBootstrap`(Windows는 `.exe`)에 `status`, `check`, `pause`, `resume`, `retry` 명령을 전달할 수 있습니다. 각각 상태 확인, 즉시 확인, 자동 업데이트 중지, 재개, 실패 버전 재시도입니다. macOS 예시:

```sh
"$HOME/Library/Application Support/Orca Custom Manager/OrcaCustomBootstrap" status
```

예약 실행은 macOS LaunchAgent, Windows 작업 스케줄러, Linux systemd 사용자 타이머가 담당합니다. 꺼져 있거나 로그아웃한 동안은 실행되지 않습니다. 기존 데스크톱 자동 업데이트는 비활성화하여 공식 앱으로 덮어쓰는 것을 막습니다. SSH 원격 서버 업데이트는 원본 Orca의 별도 기능입니다.

## 클라우드 스킬 공유

Skills 화면의 **Community skills**에서 다른 사용자의 Markdown 스킬을 검색하고 원문과 버전을 확인할 수 있습니다. 읽기는 로그인 없이 가능하며, 게시·새 버전 등록·숨기기·신고에는 별도의 커뮤니티 계정이 필요합니다. 계정 이름은 사용자가 직접 등록하는 이름이며 GitHub 인증 계정은 아닙니다.

Orca 내장 채팅에서 **`&`**를 입력하면 입력창 위에 선택 목록이 나옵니다. 선택하면 `&작성자/이름@버전`이 들어갑니다. 자동완성에서 선택한 항목을 사용하세요. Orca가 지정한 버전의 본문을 API로 읽고 해시를 확인한 뒤 에이전트에 전달합니다. 로컬 스킬 파일을 설치하지 않습니다. 목록 검색·HTTP 조회 자체에는 모델 토큰이 들지 않으며, 에이전트가 전달받은 본문을 읽을 때는 토큰을 사용합니다.

구조화된 내장 채팅에서 시작한 오케스트레이션은 같은 스킬 버전을 워커와 하위 워커에 전달합니다. PTY 모드에서도 선택한 스킬의 일반 사용은 가능하지만, PTY 코디네이터의 자동 상속은 현재 지원하지 않습니다.

조회에 실패하면 메시지를 보내지 않고 초안을 보존합니다. 여러 파일이나 스크립트에 의존하는 스킬은 지원하지 않습니다. 공유 스킬은 사용자 지침으로 전달되며 기존 도구 권한을 그대로 따릅니다. 앱 재시작 시 커뮤니티 로그인은 해제됩니다. 실행 문맥은 메모리에 유지하므로 재시작한 코디네이터에서 새 작업을 시작할 때는 스킬을 다시 선택하세요. 전달된 본문은 기존 대화 기록에 남을 수 있습니다. 초기 버전은 비밀번호 복구 기능이 없습니다.

Neon PostgreSQL과 Vercel Hobby로 운영합니다. 사용자의 앱에는 공개 HTTPS 주소만 포함하며 DB 접속 비밀값을 배포하지 않습니다. 서비스 구조와 운영 절차는 [서비스 설명](community-service/README.md)을 참고하세요.

## 개발과 배포

Node 24, pnpm 12, Python 3.13 및 OS별 네이티브 빌드 도구를 준비합니다.

```sh
pnpm install --frozen-lockfile
pnpm --dir mobile install --frozen-lockfile
python -m pip install -r distribution/requirements.txt
python -m unittest discover -s distribution/tests -v
python distribution/build.py --version 1.0.1
```

결과는 `release/`에 생성됩니다. 현재 OS·CPU용 앱만 만들며 버전을 `package.json`에 기록합니다. CI는 `1.0.<실행번호>`를 사용합니다. [배포 워크플로](.github/workflows/custom-release.yml)와 [구조 설명](distribution/ARCHITECTURE.md)을 참고하세요.

## 원본과 라이선스

원본 Orca는 Copyright (c) 2026 Lovecast Inc., MIT License입니다. [LICENSE](LICENSE)를 유지합니다. 기반 버전·커밋은 [distribution/release.json](distribution/release.json)에 기록하며 [원본 README](README.upstream.md)를 보존합니다.

## 저장소 이름 변경 안내

저장소는 `geunyoung0120/dsm-mafia-custom-orca`입니다. 이전 이름의 저장소를 대상으로 하는 v1.0.5 설치본은 새 릴리스의 설치 프로그램을 한 번 실행해 업데이터를 갱신하세요. 기존 업데이터는 저장소 이름을 엄격하게 검사하므로 GitHub 주소 리디렉션만으로 자동 이전되지 않습니다. 앱 ID와 사용자 데이터 경로는 유지됩니다.
