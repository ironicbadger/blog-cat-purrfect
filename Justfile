# Show the available authoring commands
_default:
    @just --list

# Set up the local Linux/macOS environment and install dependencies
setup:
    @set -eu; \
    run_as_root() { \
      if [ "$(id -u)" -eq 0 ]; then "$@"; \
      else command -v sudo >/dev/null || { echo "Missing required command: sudo"; exit 1; }; sudo "$@"; \
      fi; \
    }; \
    missing=""; \
    command -v node >/dev/null || missing="$missing node"; \
    command -v npm >/dev/null || missing="$missing npm"; \
    if [ -n "$missing" ]; then \
      os="$(uname -s)"; \
      case "$os" in \
        Linux) \
          if command -v pacman >/dev/null; then \
            packages=""; \
            command -v node >/dev/null || packages="$packages nodejs"; \
            command -v npm >/dev/null || packages="$packages npm"; \
            echo "Installing system packages with pacman:$packages"; \
            run_as_root pacman -Sy; \
            run_as_root pacman -S --needed $packages; \
          elif command -v apt-get >/dev/null; then \
            echo "Installing system packages with apt-get: nodejs npm"; \
            run_as_root apt-get update; \
            run_as_root apt-get install -y nodejs npm; \
          elif command -v dnf >/dev/null; then \
            echo "Installing system packages with dnf: nodejs npm"; \
            run_as_root dnf install -y nodejs npm; \
          else \
            echo "Missing required commands:$missing"; \
            echo "No supported Linux package manager found. Install Node.js 20+ and npm, then rerun just setup."; \
            exit 1; \
          fi; \
          ;; \
        Darwin) \
          command -v brew >/dev/null || { echo "Missing required commands:$missing"; echo "Homebrew is required for automatic macOS setup: https://brew.sh/"; exit 1; }; \
          echo "Installing system packages with Homebrew: node"; \
          brew install node; \
          ;; \
        *) echo "Unsupported OS: $os. This project setup supports Linux and macOS."; exit 1 ;; \
      esac; \
    fi; \
    command -v node >/dev/null || { echo "Missing required command after setup: node"; exit 1; }; \
    command -v npm >/dev/null || { echo "Missing required command after setup: npm"; exit 1; }; \
    node_major="$(node -p 'process.versions.node.split(".")[0]')"; \
    if [ "$node_major" -lt 20 ]; then \
      echo "Node 20 or newer is required. Found: $(node --version)"; \
      echo "Upgrade Node.js, then rerun just setup."; \
      exit 1; \
    fi; \
    if [ ! -f package-lock.json ]; then \
      echo "Missing package-lock.json; cannot run a reproducible install."; \
      exit 1; \
    fi; \
    echo "Environment OK: $(uname -s), node $(node --version), npm $(npm --version)"; \
    npm ci

# Create a new draft post from the review template
new:
    @node scripts/new-post.mjs

# Run the same checks used before publishing
check:
    @npm run check
    @npm run build

# Build the site and serve the production preview locally
serve:
    @npm run build
    @npm run preview

# Check, commit all changes, and push the current branch
publish: check
    @node scripts/publish.mjs
