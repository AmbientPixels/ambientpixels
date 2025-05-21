# Deploy DeviantArt Proxy Function App

# Install Azure Functions Core Tools if not installed
if (-not (Get-Command func -ErrorAction SilentlyContinue)) {
    Write-Host "Installing Azure Functions Core Tools..."
    npm install -g azure-functions-core-tools@3 --unsafe-perm true
}

# Install dependencies
Write-Host "Installing dependencies..."
npm install

# Deploy to Azure with incremental update
Write-Host "Deploying to Azure with incremental update..."
func azure functionapp publish ambientpixels-nova-api --no-build --force --update-app-settings --update-local-settings --update-extensions --no-delete-existing-files

Write-Host "Deployment complete!"
