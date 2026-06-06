#!/bin/bash
: "${BASH_VERSION:-}"
set -euo pipefail

# Version Check Script
# Validates that all skill versions are <= package.json version

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get package.json version
PACKAGE_VERSION=$(jq -r '.version' "${PROJECT_ROOT}/package.json")
if [ -z "$PACKAGE_VERSION" ] || [ "$PACKAGE_VERSION" = "null" ]; then
    echo -e "${RED}Error: Could not extract version from package.json${NC}"
    exit 1
fi

echo "📦 Package version: ${PACKAGE_VERSION}"
echo ""

# Function to compare versions (returns 0 if v1 <= v2)
version_leq() {
    local v1="$1"
    local v2="$2"
    
    # Use sort -V for version comparison
    local lowest
    lowest=$(printf '%s\n%s\n' "$v1" "$v2" | sort -V | head -n1)
    
    if [ "$v1" = "$v2" ]; then
        return 0  # equal is OK
    elif [ "$lowest" = "$v1" ]; then
        return 0  # v1 is lower, OK
    else
        return 1  # v1 is higher, NOT OK
    fi
}

# Track discrepancies
DISCREPANCIES=0

# Find all skill directories
SKILL_DIRS=$(find "${PROJECT_ROOT}/skills" -maxdepth 1 -type d -name "*" ! -name "skills" 2>/dev/null || true)

if [ -z "$SKILL_DIRS" ]; then
    echo -e "${YELLOW}Warning: No skills found in ${PROJECT_ROOT}/skills${NC}"
    exit 0
fi

echo "🔍 Checking skill versions..."
echo ""

# Check each skill
for skill_dir in $SKILL_DIRS; do
    skill_name=$(basename "$skill_dir")
    skill_file="${skill_dir}/SKILL.md"
    
    if [ ! -f "$skill_file" ]; then
        echo -e "${YELLOW}⚠️  ${skill_name}: No SKILL.md found${NC}"
        continue
    fi
    
    # Extract version from frontmatter (YAML format: version: x.y.z or "x.y.z")
    skill_version=$(grep -E '^version:\s*' "$skill_file" | head -n1 | sed -E 's/^version:[[:space:]]*//; s/["'\'']//g')
    
    if [ -z "$skill_version" ]; then
        echo -e "${YELLOW}⚠️  ${skill_name}: No version found in frontmatter${NC}"
        continue
    fi
    
    # Compare versions
    if version_leq "$skill_version" "$PACKAGE_VERSION"; then
        echo -e "${GREEN}✓${NC} ${skill_name}: ${skill_version} <= ${PACKAGE_VERSION}"
    else
        echo -e "${RED}✗${NC} ${skill_name}: ${skill_version} > ${PACKAGE_VERSION} ${RED}(DISCREPANCY)${NC}"
        DISCREPANCIES=$((DISCREPANCIES + 1))
    fi
done

echo ""

if [ $DISCREPANCIES -eq 0 ]; then
    echo -e "${GREEN}✓ All skill versions are valid (<= ${PACKAGE_VERSION})${NC}"
    exit 0
else
    echo -e "${RED}✗ Found ${DISCREPANCIES} skill(s) with version greater than package.json${NC}"
    echo ""
    echo "Run 'pnpm run version:sync' to synchronize versions"
    exit 1
fi
