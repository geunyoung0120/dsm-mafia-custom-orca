# 관리자 자동 게시

일반 사용자에게는 설치되지 않는 관리자 전용 프로그램입니다. 개인용 Orca Python 업데이터가 공식 소스를 가져와 커스텀 변경을 이식하고 검증·설치까지 성공하면, 설치 훅이 `queue/`에 이벤트를 남깁니다. 별도 macOS LaunchAgent가 1분마다 대기열을 확인합니다. 앱 종료나 개인용 설치를 배포 빌드가 막지 않습니다.

## 처리 흐름

1. `publication_queue.py`(개인용 업데이터)가 공식 커밋·검증된 패치 해시로 중복 없는 이벤트를 만듭니다. 설치가 끝나지 않으면 게시하지 않습니다. 대기열 쓰기에 실패하면 설치 기록을 보존하고 다시 시도합니다.
2. `source_merge.py`가 Git 커밋과 해시로 확인한 패치만으로 소스 스냅샷을 만듭니다. 작업 폴더의 임의 파일·로그·인증정보는 복사하지 않습니다.
3. 이전에 공개한 검증 소스와 새 소스의 차이를 최신 공개 `main`에 3-way 병합합니다. `.github/`와 `distribution/`은 공개 저장소의 것을 유지합니다. 앱 식별자·전용 데이터 경로 등 배포용 수정과 충돌하면 덮어쓰지 않습니다.
4. 로컬 Python 테스트·앱 회귀 테스트·세 종류의 타입 검사·코드 품질 검사를 실행합니다. 필요한 경우에만 설정된 Codex 모델로 최대 2회 복구를 시도합니다. 에이전트는 `src/`의 제품 코드만 수정할 수 있고 테스트·설정·Git 기록을 변경하면 중단합니다. 에이전트가 커밋하거나 푸시하지 않습니다.
5. 검증된 커밋을 일반 fast-forward 푸시합니다. 강제 푸시하지 않습니다. 푸시 직전 커밋을 기록하여 연결이 끊겼을 때 같은 커밋의 원격 반영 여부부터 확인합니다.
6. GitHub Actions의 네 플랫폼 빌드와 해당 커밋의 공개 릴리스·필수 파일을 확인한 후에만 기준 소스를 전진시킵니다. 일반 사용자들은 기존 Python 업데이터로 이 릴리스를 받습니다.

## 실패와 재시작

GitHub 조회·푸시 중 네트워크 장애는 5분 후 재시도합니다. 의존성 설치를 포함한 로컬 검증 단계의 실패는 자동으로 반복하지 않습니다. 소스 충돌·로컬 검사 실패·CI 실패는 `blocked` 상태가 되며 이전 사용자용 공개 릴리스는 유지됩니다. 개인용 앱 설치를 취소하지 않습니다. GitHub의 소스 커밋은 CI 실행을 위해 릴리스보다 먼저 올라가지만, 소비자 업데이터는 성공한 공개 릴리스만 설치합니다.

`retry`는 로컬 실패를 최신 main 기준으로 다시 검사하고, CI 실패는 같은 커밋의 실패 작업을 재실행합니다. 무한 AI 반복은 하지 않습니다. 새 원본에서 테스트나 배포 설정 변경이 필요하면 관리자 수정이 필요할 수 있습니다.

## 관리자 Mac 설치와 운영

`install.py`는 기존 개인용 업데이터의 검증된 설치 대기 소스와 이미 공개된 릴리스를 일치시켜 최초 기준을 등록합니다. `publication_queue.py`를 개인용 업데이터의 런타임 배포 목록에 넣고, `apply_pending`의 설치 성공 경로에서 `pending.json`을 지우기 전에 `enqueue_publication(config, pending)`을 호출해야 합니다. 호출 실패 시 pending을 보존해 다음 실행에서 설치 영수증으로 복구합니다. 이 기기의 개인용 소스와 런타임에는 해당 연결을 적용했습니다. 설치 프로그램도 연결 유무를 확인합니다. 인증은 기존 `gh`/Git 인증 저장소를 사용하며 토큰을 설정 파일에 저장하지 않습니다. 초기 등록의 저장소 ID는 `geunyoung0120/dsm-mafia-custom-orca`에 고정되어 있습니다.

기본 저장 위치는 `~/Library/Application Support/Orca Custom Publisher`입니다. `checkout/`은 관리자 편집 폴더와 분리된 전용 복사본입니다. `queue/`, `records/`, `baseline.json`, `logs/`는 로컬에만 남습니다. 초기화는 기존 등록을 덮어쓰지 않습니다.

```sh
python3 distribution/maintainer/install.py --personal-home "$HOME/Library/Application Support/Orca Custom Updater"
python3 "$HOME/Library/Application Support/Orca Custom Publisher/publisher.py" --home "$HOME/Library/Application Support/Orca Custom Publisher" status
python3 "$HOME/Library/Application Support/Orca Custom Publisher/publisher.py" --home "$HOME/Library/Application Support/Orca Custom Publisher" retry
launchctl print "gui/$(id -u)/local.orca.custom-publisher"
```

실행은 로그인 후 macOS가 예약하며, 잠자기·종료 중에는 동작하지 않습니다. 다음 실행 때 남은 대기열을 이어갑니다. 일반 사용자에게 이 관리자 예약 작업이나 GitHub 쓰기 권한은 필요하지 않습니다. 관리자 자동 게시 코드의 업데이트는 검토 후 별도로 설치하며 공개 소스 변경으로 런타임을 무조건 교체하지 않습니다.
