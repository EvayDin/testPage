# macOS PostgreSQL 安装、配置与维护指南

本文面向当前 `testPage` 项目，从安装 PostgreSQL 开始，记录独立数据库实例的创建、应用连接、密码修改与恢复，以及常见问题的排查方法。

**你当前已经完成安装、初始化和建库，不需要重新初始化。** 日常开发从第 7 节开始；忘记密码时查看第 9 节。

## 1. 先认识几个概念

| 名称 | 含义 | 本项目使用的值 |
| --- | --- | --- |
| PostgreSQL | 数据库软件 | Postgres.app 提供的 PostgreSQL 18 |
| 实例 / cluster | 一个服务进程管理的一组数据库，有自己的账号和数据目录 | 当前项目的独立实例 |
| 数据目录 | 保存数据库文件、账号信息及配置的目录 | `testPage/.local/postgres` |
| 端口 | 应用连接实例的入口 | `5433` |
| 数据库 | 实例内保存业务数据的逻辑容器 | `launchpad` |
| 数据库角色 / 用户 | 连接数据库的身份，与 macOS 用户是两回事 | `launchpad` |
| 业务表 | 保存用户、会话等业务记录的表 | 后端启动时自动创建 |
| 连接字符串 | 包含账号、地址、端口等信息的连接参数 | `DATABASE_URL` |

本机已有另一个项目在使用 `5432`。本文为当前项目使用 `5433`，账号和数据目录也独立，不依赖另一个项目的数据库。

注意：本文通过 `initdb -U launchpad` 创建的 `launchpad` 是这个独立实例的数据库超级用户，适合当前本地开发流程；上线时应使用权限受限的业务账号。

## 2. 在 macOS 安装 PostgreSQL

### 2.1 安装 Postgres.app

1. 打开 [Postgres.app 官方下载页面](https://postgresapp.com/downloads.html)。
2. 下载适合当前 Mac 的安装包，本文使用包含 PostgreSQL 18 的版本。
3. 打开下载的文件，将 `Postgres.app` 拖到「应用程序」目录。
4. 打开一次 Postgres.app，按 macOS 提示允许运行。

本文用命令行创建项目专用实例，因此不要求在图形界面再次点击 Initialize 创建默认实例。如果你已经安装好了，直接继续检查版本。

### 2.2 检查命令是否可用

在 macOS 的「终端」执行：

```sh
/Applications/Postgres.app/Contents/Versions/18/bin/psql --version
```

中文解析：

- `/Applications/Postgres.app`：安装的软件目录。
- `Contents/Versions/18/bin`：PostgreSQL 18 的命令行工具目录。
- `psql`：连接数据库的终端客户端。
- `--version`：只显示客户端版本，不会启动数据库或连接服务器。

预期看到类似 `psql (PostgreSQL) 18.x`。如果提示文件不存在，请先检查是否安装在「应用程序」中，以及安装包是否包含版本 18。

本文一直使用完整命令路径，不要求配置 PATH。如果安装的是其他主版本，需要调整路径；已有数据目录必须配合兼容的服务端主版本使用，不能仅通过改路径完成跨主版本升级。

## 3. 准备项目目录

### 3.1 进入项目根目录

```sh
cd /Users/dingzhipeng/Documents/test/testPage
```

中文解析：`cd` 表示切换目录，后面的路径是当前项目位置。其他电脑需要替换成自己的项目路径。

后文所有带 `$PWD` 的命令都假设你位于项目根目录。`$PWD` 表示终端当前所在目录；双引号用于正确处理路径里的空格。

### 3.2 创建本地运行目录

```sh
mkdir -p .local
```

中文解析：`mkdir` 创建目录；`-p` 允许父目录不存在，也允许目标目录已经存在；`.local` 用于保存当前电脑的数据库文件和日志。

确认项目 `.gitignore` 包含：

```gitignore
.local/
.env
.env.local
```

中文解析：这些规则使 Git 忽略数据库文件和本机环境配置。当前项目已配置这些规则。不要把真实连接密码写进需要提交的文档或代码中。

### 3.3 检查 5433 端口

```sh
lsof -nP -iTCP:5433 -sTCP:LISTEN
```

中文解析：

- `lsof`：查看进程使用的文件或网络连接。
- `-nP`：直接显示 IP 和端口数字，避免名称解析。
- `-iTCP:5433`：只查看 TCP 的 5433 端口。
- `-sTCP:LISTEN`：只显示正在监听的服务。

没有输出通常表示没有查到监听者。如果已经是本项目的 PostgreSQL，跳过初始化，检查服务状态即可；如果属于其他服务，请选择其他空闲端口，并同步修改后续命令和连接字符串。

## 4. 初始化独立实例（只做一次）

**已有 `.local/postgres` 且已成功初始化时，跳过本节。不要为了排错删除数据目录。**

```sh
/Applications/Postgres.app/Contents/Versions/18/bin/initdb \
  -D "$PWD/.local/postgres" \
  -U launchpad \
  -A scram-sha-256 \
  --encoding=UTF8 \
  -W
```

中文解析：

- `initdb`：创建新的数据库实例及基础系统数据库，不是创建业务表。
- `-D "$PWD/.local/postgres"`：指定新实例的数据目录。
- `-U launchpad`：创建名为 `launchpad` 的初始数据库超级用户。
- `-A scram-sha-256`：为本地 socket 和 TCP 连接配置 SCRAM 密码认证。
- `--encoding=UTF8`：设置默认字符编码为 UTF-8，支持中文等字符。
- `-W`：交互式输入初始账号密码，通常需要输入两次。
- 行尾 `\`：表示命令在下一行继续，反斜杠后不要加空格。

输入密码时屏幕不显示字符或星号，这是正常现象。记住这次设置的数据库密码，它与 Mac 登录密码没有必然关系。不要使用 `sudo` 执行此初始化命令。

看到 `Success. You can now start the database server using:` 表示初始化成功。此时只是准备好文件，还没有启动服务，也还没有创建名为 `launchpad` 的业务数据库。

## 5. 启动实例并创建业务数据库

### 5.1 启动服务

```sh
/Applications/Postgres.app/Contents/Versions/18/bin/pg_ctl \
  -D "$PWD/.local/postgres" \
  -l "$PWD/.local/postgres.log" \
  -o "-h 127.0.0.1 -p 5433" \
  start
```

中文解析：

- `pg_ctl`：管理 PostgreSQL 服务的工具。
- `-D`：指定要管理的实例数据目录。
- `-l`：指定服务日志文件；已有文件会追加日志。
- `-o`：把引号内参数传给数据库服务进程。
- `-h 127.0.0.1`：TCP 仅监听本机回环地址。
- `-p 5433`：数据库使用 5433 端口，避开其他项目的 5432。
- `start`：在后台启动服务；正常情况下关闭当前终端不会停止数据库。

预期看到 `server started`。初始化成功信息里给出的简化启动示例未指定 5433，请使用本文这条命令，避免端口冲突。

### 5.2 检查服务状态

```sh
/Applications/Postgres.app/Contents/Versions/18/bin/pg_ctl \
  -D "$PWD/.local/postgres" \
  status
```

中文解析：`status` 查询指定数据目录对应的实例是否运行，通常会显示进程号和启动参数。该命令不会验证账号密码是否正确。

### 5.3 创建业务数据库（只做一次）

```sh
/Applications/Postgres.app/Contents/Versions/18/bin/createdb \
  -h 127.0.0.1 \
  -p 5433 \
  -U launchpad \
  launchpad
```

中文解析：

- `createdb`：在已运行的实例中创建数据库。
- `-h 127.0.0.1`：通过 TCP 连接本机。
- `-p 5433`：连接当前独立实例。
- `-U launchpad`：使用初始化时创建的数据库用户。
- 最后的 `launchpad`：要创建的数据库名称；它与用户名恰好相同，但含义不同。

输入第 4 节设置的密码。成功时通常没有额外输出，直接回到终端提示符。若提示 `database "launchpad" already exists`，表示数据库已经存在，无需再次创建。

### 5.4 验证能否登录

```sh
/Applications/Postgres.app/Contents/Versions/18/bin/psql \
  -h 127.0.0.1 \
  -p 5433 \
  -U launchpad \
  -d launchpad
```

中文解析：`psql` 打开交互式数据库终端；`-h`、`-p`、`-U` 分别指定地址、端口、用户；`-d launchpad` 明确指定要连接的业务数据库。

连接后执行：

```sql
SELECT current_user, current_database(), inet_server_port();
```

中文解析：`SELECT` 查询信息；三个函数分别返回当前数据库用户、数据库名称和本次 TCP 连接的服务器端口。预期为 `launchpad`、`launchpad`、`5433`。

退出交互终端：

```text
\q
```

中文解析：`\q` 是 psql 的退出命令，不需要分号。SQL 通常以分号结束，psql 的反斜杠命令通常不需要。

## 6. 配置后端连接

### 6.1 准备正确的环境文件

如果没有配置文件，在项目根目录执行：

```sh
cp apps/api/.env.example apps/api/.env.local
```

中文解析：`cp` 将模板复制为本机配置文件。**如果 `.env.local` 已经配置好，请跳过，重复执行会覆盖原配置。**

如果你已经把连接信息写在 `.env`，且 `.env.local` 不存在，应改用：

```sh
mv apps/api/.env apps/api/.env.local
```

中文解析：`mv` 在这里用于重命名文件，保留已有配置内容。两条命令是按情况二选一，不要连续执行。重命名前先确认没有需要保留的同名目标文件。

当前项目的开发、生产本地启动及迁移脚本都读取 `apps/api/.env.local`。仅配置 `.env` 不会被这些脚本自动读取。

### 6.2 填写配置

用编辑器打开 `apps/api/.env.local`，填写：

```dotenv
DATABASE_URL=postgresql://launchpad:替换成实际密码@127.0.0.1:5433/launchpad?sslmode=disable
APP_ORIGIN=http://localhost:5173
COOKIE_SECURE=false
HOST=127.0.0.1
PORT=3000
```

中文解析：

| 配置项 | 含义 |
| --- | --- |
| `DATABASE_URL` | 后端连接 PostgreSQL 的地址，需要替换实际密码 |
| `APP_ORIGIN` | 本地网页来源地址，用于请求来源校验 |
| `COOKIE_SECURE=false` | 本地使用 HTTP，登录 Cookie 不强制要求 HTTPS |
| `HOST=127.0.0.1` | 后端 API 只监听本机 |
| `PORT=3000` | 后端 HTTP 端口，与数据库端口 5433 是两个不同的端口 |

`dotenv` 代码块是文件内容，不是在终端执行的命令。不要把 `DATABASE_URL` 改成 `VITE_DATABASE_URL`，数据库密码只能用于后端。

连接字符串拆解：

```text
postgresql://用户名:密码@主机:端口/数据库名?连接参数
```

| 片段 | 本项目含义 |
| --- | --- |
| `postgresql://` | PostgreSQL 连接协议 |
| `launchpad:` | 数据库用户名，以及后面的密码分隔符 |
| `替换成实际密码` | 初始化或最近一次修改后的密码 |
| `@127.0.0.1` | 数据库位于本机 |
| `:5433` | 当前独立实例的端口 |
| `/launchpad` | 业务数据库名称 |
| `?sslmode=disable` | 本文的本机实例不使用 SSL |

`sslmode=disable` 仅针对本文本机开发方式。连接托管或远程数据库时，应使用服务商要求的 SSL 配置。

如果密码包含特殊字符，连接字符串中的密码部分需要 URL 编码，例如 `@` 写成 `%40`、`:` 写成 `%3A`、`/` 写成 `%2F`、`#` 写成 `%23`、`%` 写成 `%25`。数据库实际密码保持原字符，只对 URL 中的表示进行编码。

### 6.3 启动应用

```sh
pnpm dev
```

中文解析：在项目根目录运行，先构建共享包，再同时启动前端和后端。后端会加载 `.env.local`，连接数据库并自动初始化用户和会话表，成功后监听 `127.0.0.1:3000`。

浏览器访问 `http://localhost:5173/register` 验证注册。修改 `.env.local` 后，请在原开发终端按 `Ctrl+C` 停止，再重新运行，不要依赖开发监听器自动重新加载环境文件。

如果需要单独执行建表迁移，可以运行：

```sh
pnpm db:migrate
```

中文解析：执行项目配置的数据库迁移脚本，读取同一份环境配置，初始化所需表结构。数据库本身需要已经创建；正常开发启动已自动执行初始化，因此通常无需额外执行此命令。

## 7. 每天开发时怎么操作

1. 打开终端，使用第 3.1 节的 `cd` 命令进入项目根目录。
2. 使用第 5.2 节的 `pg_ctl ... status` 检查实例是否运行。
3. 未运行时，执行第 5.1 节完整的启动命令，继续使用 5433。
4. 执行 `pnpm dev`，打开网页。

不需要每天执行 `initdb` 或 `createdb`。数据库服务与应用服务是两个进程，停止 `pnpm dev` 不会自动停止 PostgreSQL；电脑重启后，按本文命令启动的实例通常需要手动重新启动。

### 7.1 停止数据库

先停止正在使用该数据库的应用，再执行：

```sh
/Applications/Postgres.app/Contents/Versions/18/bin/pg_ctl \
  -D "$PWD/.local/postgres" \
  -m fast \
  stop
```

中文解析：`stop` 停止指定实例；`-m fast` 断开连接、回滚未完成事务并正常关闭数据库。它不是直接强杀进程，不会删除数据库文件。

### 7.2 重启数据库

```sh
/Applications/Postgres.app/Contents/Versions/18/bin/pg_ctl \
  -D "$PWD/.local/postgres" \
  -m fast \
  -l "$PWD/.local/postgres.log" \
  -o "-h 127.0.0.1 -p 5433" \
  restart
```

中文解析：`restart` 先正常停止再启动指定实例；`-m fast` 的含义同上；日志位置、监听地址和端口与首次启动保持一致。此操作会中断当前数据库连接。

## 8. 记得旧密码时，修改数据库密码

先用第 5.4 节的 `psql` 命令登录，再在 psql 中执行：

```text
\password launchpad
```

中文解析：`\password` 交互式修改指定角色的密码；`launchpad` 是要修改的角色。按提示输入两次新密码，输入不显示在屏幕上。相较于把密码写在 SQL 文本中，这种方式避免明文密码进入命令历史。

随后用 `\q` 退出，把 `.env.local` 中连接字符串的密码同步更新，再重启 `pnpm dev`。可以重新执行第 5.4 节的 TCP 登录命令，确认新密码有效。

数据库用户密码与网页注册账号密码不同。修改 `launchpad` 的密码不会修改网站用户的登录密码。

## 9. 忘记数据库密码时如何恢复

### 9.1 本次排查实际发生了什么

最初连接 `127.0.0.1:5432` 时，`dingzhipeng` 密码认证失败。检查后确认，该端口运行的是另一个项目的数据目录，TCP 使用密码认证，而该实例的 Unix socket 连接配置为 `trust`，因此可以通过其 socket 路径免密连接。

当时提供的是通过已有 socket 登录、再创建独立账号的办法，**并未实际重置 `dingzhipeng` 的密码**。后来选择了在当前项目中初始化新实例，创建 `launchpad` 用户，使用 5433，实现了实例隔离。

为了保留该知识点，下面说明 socket 连接的含义，并给出当前独立实例真正忘记密码时的完整恢复步骤。所有恢复操作只针对 `.local/postgres`。

### 9.2 socket 为什么有时可以免密

- `-h 127.0.0.1` 使用 TCP，匹配 `pg_hba.conf` 中的 `host` 规则。
- `-h /某个目录` 使用该目录里的 Unix socket，匹配 `local` 规则。
- 是否需要密码取决于匹配的认证规则，不取决于有没有使用 `psql`。
- `trust` 表示允许符合规则的连接无需密码认证；`scram-sha-256` 表示需要密码认证。

本文第 4 节用了 `-A scram-sha-256`，因此新实例的 socket 默认也需要密码。不能直接照搬另一个实例的免密连接方式。

### 9.3 确认实例、停止应用并备份认证文件

本流程适用于你拥有本机数据目录访问权、需要恢复自己这个开发实例的情况。先按 `Ctrl+C` 停止 `pnpm dev`，保持数据库运行，然后确认自己位于 `testPage` 根目录。

```sh
cp -p .local/postgres/pg_hba.conf ".local/pg_hba.conf.before-reset.$(date +%Y%m%d-%H%M%S)"
```

中文解析：

- `cp -p`：复制文件并保留原文件权限等属性。
- `pg_hba.conf`：数据库客户端认证规则文件。
- `$(date +%Y%m%d-%H%M%S)`：把当前日期和时间加入备份文件名，避免覆盖旧备份。
- 备份位于数据目录外的 `.local` 中，但仍受 Git 忽略规则保护。

记下实际生成的备份文件名，后面恢复时需要使用。

### 9.4 只临时放行当前角色的本地 socket

用编辑器打开 `testPage/.local/postgres/pg_hba.conf`，在所有现有认证规则之前增加这一行：

```text
local   all   launchpad   trust
```

中文解析：`local` 仅匹配 Unix socket；`all` 允许该角色连接任意数据库；`launchpad` 仅匹配这个角色；`trust` 临时免去密码认证。认证规则按顺序匹配，因此必须放在其他可能匹配的 `local` 规则之前。

只保留完成恢复所需的短暂时间，不要把 TCP 的 `host` 规则改为 `trust`。本步骤修改的是当前项目实例的文件，不要改其他项目的数据目录。

### 9.5 重新加载认证配置

```sh
/Applications/Postgres.app/Contents/Versions/18/bin/pg_ctl \
  -D "$PWD/.local/postgres" \
  reload
```

中文解析：`reload` 通知正在运行的指定实例重新读取配置，不会停止服务。若文件有语法错误，需要通过日志确认并修正；命令成功发送通知不代表所有配置一定生效。

### 9.6 用明确的 socket 路径登录

为避免连接到别的实例，先查看当前实例生成的 socket 锁文件：

```sh
cat .local/postgres/postmaster.pid
```

中文解析：`cat` 只读显示服务进程状态文件；该文件通常包含进程号、数据目录、端口和 socket 目录等信息。不要手动编辑或删除它。Unix socket 目录通常在第 5 行；结合端口 5433 确认实例。

如果确认 socket 目录为 `/tmp`，执行：

```sh
/Applications/Postgres.app/Contents/Versions/18/bin/psql \
  -h /tmp \
  -p 5433 \
  -U launchpad \
  -d postgres
```

中文解析：`-h /tmp` 指定 Unix socket 目录，使用刚才临时添加的 `local` 规则；`-p 5433` 指定该端口对应的 socket 文件；`-U launchpad` 使用要恢复的角色；`-d postgres` 连接初始化时已有的管理数据库。如果实际 socket 目录不是 `/tmp`，替换 `-h` 后的目录。

### 9.7 设置新密码

在 psql 中执行：

```text
\password launchpad
```

中文解析：为当前实例的 `launchpad` 角色设置新密码，按提示输入两次。完成后执行 `\q` 退出。

### 9.8 立即恢复原认证配置

将第 9.3 节保存的备份复制回原位置。以下文件名只是格式示例，必须替换为你实际生成的备份名称：

```sh
cp -p .local/pg_hba.conf.before-reset.20261030-120000 .local/postgres/pg_hba.conf
```

中文解析：将重置前的认证文件完整恢复，撤销临时 `trust` 规则。不要使用不存在的示例文件，也不要覆盖成其他实例的配置。

再次执行第 9.5 节的 `pg_ctl ... reload`，然后使用第 5.4 节的 TCP 命令重新登录，输入新密码验证。恢复流程没有完成前，不要重新启动应用。

最后更新 `.env.local` 中的密码，重新运行 `pnpm dev`。密码修改只影响该角色，不会删除已有业务数据。

## 10. 常用查看命令

先使用第 5.4 节命令进入 psql。以下命令在 psql 内执行，不是在 macOS 普通终端执行。

| 命令 | 中文解析 |
| --- | --- |
| `\conninfo` | 显示当前连接的数据库、用户、地址或 socket、端口等信息 |
| `\l` | 列出当前实例内的数据库 |
| `\du` | 列出当前实例的角色及权限属性 |
| `\dt` | 列出当前搜索路径中可见的业务表 |
| `\d users` | 查看 `users` 表的列、索引和约束 |
| `SELECT COUNT(*) FROM users;` | 查询用户记录总数，不显示密码摘要等字段 |
| `\q` | 退出 psql，返回普通终端 |

后端第一次成功启动前，`\dt` 可能尚未显示业务表，这是正常情况。

## 11. 备份与恢复

### 11.1 导出当前业务数据库

在项目根目录执行：

```sh
mkdir -p .local/backups
```

中文解析：创建备份目录，已存在时保持原目录不变。

```sh
/Applications/Postgres.app/Contents/Versions/18/bin/pg_dump \
  -h 127.0.0.1 \
  -p 5433 \
  -U launchpad \
  -d launchpad \
  -Fc \
  -f ".local/backups/launchpad-$(date +%Y%m%d-%H%M%S).dump"
```

中文解析：`pg_dump` 导出一个数据库；连接参数与登录一致；`-Fc` 使用自定义归档格式；`-f` 指定备份文件；日期时间生成不同文件名。按提示输入数据库密码，成功后检查目标文件是否存在。

这份备份包含业务数据，不包含实例级角色密码等全部配置。备份和数据目录放在同一块磁盘只能防部分误操作，重要数据还需要另存副本。

### 11.2 恢复到新的数据库，便于检查

```sh
/Applications/Postgres.app/Contents/Versions/18/bin/createdb \
  -h 127.0.0.1 -p 5433 -U launchpad launchpad_restore
```

中文解析：在同一实例中新建 `launchpad_restore`，作为恢复目标，不覆盖原来的 `launchpad`。目标数据库名必须尚未存在。

```sh
/Applications/Postgres.app/Contents/Versions/18/bin/pg_restore \
  -h 127.0.0.1 \
  -p 5433 \
  -U launchpad \
  -d launchpad_restore \
  --exit-on-error \
  .local/backups/launchpad-20261030-120000.dump
```

中文解析：`pg_restore` 将归档内容恢复到 `-d` 指定的数据库；`--exit-on-error` 遇到错误立即停止；最后一个参数是备份文件路径，必须替换为实际文件名。目标数据库应为空；该命令不保证错误发生时自动回滚此前所有操作。

需要检查恢复结果时，将第 5.4 节登录命令中的 `-d launchpad` 改为 `-d launchpad_restore`，再使用第 10 节的查看命令。应用仍使用 `.env.local` 中配置的数据库，恢复操作不会自动切换应用连接。

## 12. 常见报错与排查顺序

### 12.1 `请设置 DATABASE_URL，连接你的 PostgreSQL 数据库`

含义：后端进程没有读到 `DATABASE_URL`，通常还没有进入实际数据库连接阶段。

检查：文件是否准确命名为 `apps/api/.env.local`；是否有拼写正确的 `DATABASE_URL=...`；是否在改完后重启了 `pnpm dev`。本次故障就是把配置写入 `.env`，而启动脚本读取 `.env.local`。

### 12.2 Vite 报 `ECONNREFUSED 127.0.0.1:3000`

含义：前端代理无法连接后端 HTTP 服务。这里的 3000 是 API 端口，不是数据库端口。

先查看 `apps/api dev` 的前置日志。如果后端因为缺少环境变量、密码错误或数据库未启动而退出，应先修复后端。前端代理默认转发到 3000，本项目无需将代理改成 5433。

### 12.3 数据库连接被拒绝，例如 `127.0.0.1:5433`

含义：指定地址上没有服务接受连接，或监听配置不匹配。用第 5.2 节检查实例状态，再用第 3.3 节检查端口，必要时按第 5.1 节启动。

### 12.4 `password authentication failed for user ...`

含义：数据库拒绝了该身份的密码认证。不能只据此断定用户一定存在，也可能连错实例或填写了错误用户名。

核对端口 5433、用户 `launchpad`、数据库 `launchpad`。使用第 5.4 节直接登录，区分“密码本身错误”和“连接字符串编码错误”。忘记密码时按第 9 节恢复，不要删除数据重新初始化。

### 12.5 `database "launchpad" does not exist`

含义：服务已经响应，但当前实例中没有这个数据库。先确认连接的是 5433，再执行第 5.3 节的创建命令。

### 12.6 `server does not support SSL, but SSL was required`

含义：连接参数要求 SSL，而当前本机实例未配置 SSL。本文实例的连接字符串使用 `sslmode=disable`；远程服务不要直接照此关闭 SSL。

### 12.7 `directory ... exists but is not empty`

含义：初始化目标目录已经有内容。可能已经初始化成功，先检查服务状态和现有数据，不要删除 `.local/postgres` 来绕过错误。

### 12.8 启动失败、端口占用或需要查看详细原因

```sh
tail -n 80 .local/postgres.log
```

中文解析：`tail` 查看文件末尾；`-n 80` 显示最近 80 行日志。日志通常能说明端口冲突、配置语法错误或目录权限问题。

端口被占用时，用第 3.3 节命令确认监听者。不要直接停止其他项目的数据库，也不要手动删除 `postmaster.pid`。

## 13. 本项目的配置速查

| 项目 | 当前约定 |
| --- | --- |
| 项目目录 | `/Users/dingzhipeng/Documents/test/testPage` |
| PostgreSQL 工具 | `/Applications/Postgres.app/Contents/Versions/18/bin` |
| 数据目录 | `.local/postgres` |
| 数据库日志 | `.local/postgres.log` |
| 数据库地址 | `127.0.0.1:5433` |
| 数据库用户 | `launchpad` |
| 业务数据库 | `launchpad` |
| 数据库密码 | 初始化或最近一次修改时设置，不在文档中记录 |
| 后端配置文件 | `apps/api/.env.local` |
| 后端 HTTP 地址 | `http://127.0.0.1:3000` |
| 前端访问地址 | `http://localhost:5173` |

## 14. 官方资料

本文命令参数已结合本机 PostgreSQL 18 工具帮助及项目启动脚本核对。安装步骤参见 [Postgres.app 安装说明](https://postgresapp.com/documentation/install.html)。

- [PostgreSQL 18：initdb](https://www.postgresql.org/docs/18/app-initdb.html)：初始化参数和初始超级用户。
- [PostgreSQL 18：pg_ctl](https://www.postgresql.org/docs/18/app-pg-ctl.html)：服务启动、停止和配置重载。
- [PostgreSQL 18：psql](https://www.postgresql.org/docs/18/app-psql.html)：终端连接和交互式命令。
