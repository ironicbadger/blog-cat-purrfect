# Show the available authoring commands
_default:
    @just --list

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
