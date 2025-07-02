# Full API Functions Deployment Script - No ZIP Mode
# Following Windsurf Dev Protocol - Replace with Precision

Write-Host "🌊 Full API Folder Deployment - Windsurf Protocol" -ForegroundColor Cyan
Write-Host "Deploying all functions in API folder without using ZIP deployment..." -ForegroundColor Yellow

# Set working directory to API folder
Set-Location "c:\ambientpixels\EchoGrid\api"

# Deploy all functions with --nozip flag to preserve function structure
Write-Host "Deploying all functions using non-ZIP method..." -ForegroundColor Cyan
func azure functionapp publish ambientpixels-nova-api --nozip

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Successfully deployed all functions" -ForegroundColor Green
    Write-Host "This deployment maintains function-level structure and should not have deleted functions" -ForegroundColor Green
} else {
    Write-Host "❌ Error during deployment" -ForegroundColor Red
}

Write-Host "Deployment complete! Verify in Azure Portal that all functions are available." -ForegroundColor Yellow
