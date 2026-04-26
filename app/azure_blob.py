from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Optional

from .config import Settings
from .models import BlobUploadResult, slugify


class AzureBlobUploader:
    """Uploads source files to Azure Blob Storage and returns a SAS URL."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def upload_file(self, file_path: str, document_id: str, metadata: Optional[Dict[str, str]] = None) -> BlobUploadResult:
        if not self.settings.azure_blob_connection_string:
            raise RuntimeError("AZURE_BLOB_CONNECTION_STRING n'est pas configuré.")

        try:
            from azure.storage.blob import BlobServiceClient, ContentSettings, generate_blob_sas
            from azure.storage.blob import BlobSasPermissions
        except ImportError as exc:  # pragma: no cover - requires Azure deps
            raise RuntimeError("azure-storage-blob est requis pour l'upload Blob.") from exc

        service_client = BlobServiceClient.from_connection_string(self.settings.azure_blob_connection_string)
        container_name = self.settings.azure_blob_container
        container_client = service_client.get_container_client(container_name)
        try:
            container_client.create_container()
        except Exception:
            pass

        source = Path(file_path)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        extension = source.suffix.lower() or ".pdf"
        blob_name = f"{self.settings.azure_blob_prefix}/{slugify(document_id)}/{timestamp}_{slugify(source.stem)}{extension}"
        blob_client = container_client.get_blob_client(blob_name)

        content_type = "application/pdf" if extension == ".pdf" else "text/plain"
        with source.open("rb") as handle:
            response = blob_client.upload_blob(
                handle,
                overwrite=True,
                metadata={**(metadata or {}), "document_id": document_id, "source_file": source.name},
                content_settings=ContentSettings(content_type=content_type),
            )

        credential = service_client.credential
        account_key = getattr(credential, "account_key", None)
        if account_key is None and isinstance(credential, dict):
            account_key = credential.get("account_key")
        if account_key is None:
            raise RuntimeError("Impossible de générer un SAS Blob avec les identifiants fournis.")

        sas_token = generate_blob_sas(
            account_name=service_client.account_name,
            container_name=container_name,
            blob_name=blob_name,
            account_key=account_key,
            permission=BlobSasPermissions(read=True),
            expiry=datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=4),
        )
        sas_url = f"{blob_client.url}?{sas_token}"
        return BlobUploadResult(
            blob_name=blob_name,
            blob_url=blob_client.url,
            sas_url=sas_url,
            container=container_name,
            version_id=getattr(response, "version_id", None),
            etag=getattr(response, "etag", None),
        )
