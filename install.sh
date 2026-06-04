#!/bin/bash

#======================================
# Doc Reader 一键安装脚本
# 支持本地执行和远程 curl 执行
#======================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 项目配置
REPO_URL="https://github.com/EaniaHuui/doc-reader.git"
INSTALL_DIR="$HOME/doc-reader"

# 打印函数
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_step() {
    echo -e "${CYAN}==>${NC} $1"
}

# 显示欢迎信息
show_banner() {
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}     Doc Reader 安装脚本${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
}

# 检查命令是否存在
check_command() {
    if ! command -v "$1" &> /dev/null; then
        return 1
    fi
    return 0
}

# 检查 Python 版本
check_python() {
    print_step "检查 Python 环境..."

    if check_command python3; then
        PYTHON_CMD=python3
    elif check_command python; then
        PYTHON_CMD=python
    else
        print_error "未找到 Python，请先安装 Python 3.8+"
        echo ""
        echo "安装 Python:"
        echo "  Ubuntu/Debian: sudo apt install python3 python3-venv"
        echo "  CentOS/RHEL:   sudo yum install python3"
        echo "  macOS:         brew install python3"
        exit 1
    fi

    PYTHON_VERSION=$($PYTHON_CMD --version 2>&1 | awk '{print $2}')
    print_success "找到 Python $PYTHON_VERSION"

    # 检查版本是否 >= 3.8
    MAJOR=$(echo "$PYTHON_VERSION" | cut -d. -f1)
    MINOR=$(echo "$PYTHON_VERSION" | cut -d. -f2)

    if [ "$MAJOR" -lt 3 ] || ([ "$MAJOR" -eq 3 ] && [ "$MINOR" -lt 8 ]); then
        print_error "Python 版本过低，需要 3.8 或更高版本"
        exit 1
    fi
}

# 检查 Git
check_git() {
    print_step "检查 Git..."

    if ! check_command git; then
        print_error "未找到 Git，请先安装 Git"
        echo ""
        echo "安装 Git:"
        echo "  Ubuntu/Debian: sudo apt install git"
        echo "  CentOS/RHEL:   sudo yum install git"
        echo "  macOS:         brew install git"
        exit 1
    fi

    print_success "Git 已安装"
}

# 克隆仓库
clone_repo() {
    print_step "克隆仓库..."

    if [ -d "$INSTALL_DIR" ]; then
        print_warning "目录 $INSTALL_DIR 已存在"
        read -p "是否删除并重新安装? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm -rf "$INSTALL_DIR"
        else
            print_info "使用现有目录"
            cd "$INSTALL_DIR"
            return
        fi
    fi

    git clone "$REPO_URL" "$INSTALL_DIR"
    print_success "仓库克隆完成"

    cd "$INSTALL_DIR"
}

# 创建虚拟环境
create_venv() {
    print_step "创建虚拟环境..."

    if [ -d "venv" ]; then
        print_warning "虚拟环境已存在，跳过创建"
    else
        $PYTHON_CMD -m venv venv
        print_success "虚拟环境创建成功"
    fi
}

# 激活虚拟环境
activate_venv() {
    print_step "激活虚拟环境..."

    if [ -f "venv/bin/activate" ]; then
        source venv/bin/activate
        print_success "虚拟环境已激活"
    else
        print_error "虚拟环境激活失败"
        exit 1
    fi
}

# 安装依赖
install_dependencies() {
    print_step "安装依赖包..."

    pip install --upgrade pip -q
    pip install -r requirements.txt -q

    print_success "依赖安装完成"
}

# 创建配置文件
create_config() {
    print_step "检查配置文件..."

    if [ -f "config.yaml" ]; then
        print_warning "config.yaml 已存在，跳过创建"
    else
        if [ -f "config.yaml.example" ]; then
            cp config.yaml.example config.yaml
            print_success "已创建 config.yaml"
        else
            print_error "config.yaml.example 不存在"
            exit 1
        fi
    fi
}

# 显示完成信息
show_complete() {
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}     安装完成！${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "安装目录: $INSTALL_DIR"
    echo ""
    echo -e "${CYAN}快速开始：${NC}"
    echo ""
    echo "  1. 进入目录："
    echo -e "     ${YELLOW}cd $INSTALL_DIR${NC}"
    echo ""
    echo "  2. 编辑配置文件（配置文档目录）："
    echo -e "     ${YELLOW}vi config.yaml${NC}"
    echo ""
    echo "  3. 启动服务："
    echo -e "     ${YELLOW}./start.sh${NC}"
    echo ""
    echo "  4. 访问应用："
    echo -e "     ${BLUE}http://localhost:5000${NC}"
    echo ""
    echo -e "${CYAN}认证说明：${NC}"
    echo "     默认示例配置已关闭认证。"
    echo "     如需启用，请先编辑 config.yaml，修改 jwt_secret 和 users。"
    echo ""
}

# 本地安装模式（脚本已在项目目录内）
local_install() {
    show_banner
    check_python
    create_venv
    activate_venv
    install_dependencies
    create_config
    show_complete
}

# 远程安装模式（通过 curl 执行）
remote_install() {
    show_banner
    check_python
    check_git
    clone_repo
    create_venv
    activate_venv
    install_dependencies
    create_config
    show_complete
}

# 显示帮助
show_help() {
    echo "Doc Reader 安装脚本"
    echo ""
    echo "用法:"
    echo "  ./install.sh          本地安装（在项目目录内执行）"
    echo "  ./install.sh --remote 远程安装（自动克隆仓库）"
    echo "  ./install.sh --help   显示帮助信息"
    echo ""
    echo "一键安装:"
    echo "  curl -fsSL https://raw.githubusercontent.com/EaniaHuui/doc-reader/main/install.sh | bash"
    echo ""
}

# 主入口
main() {
    case "${1:-}" in
        -h|--help|help)
            show_help
            exit 0
            ;;
        -r|--remote|remote)
            remote_install
            ;;
        "")
            # 检测是否在项目目录内
            if [ -f "app.py" ] && [ -f "requirements.txt" ]; then
                local_install
            else
                # 不在项目目录，执行远程安装
                remote_install
            fi
            ;;
        *)
            print_error "未知参数: $1"
            show_help
            exit 1
            ;;
    esac
}

# 运行安装
main "$@"
