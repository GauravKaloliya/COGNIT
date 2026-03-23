import uuid

from app.config import PAYMENT_MAX_IMAGE_MB, PAYMENT_UPLOAD_URL_EXPIRY_SECONDS
from app.constants.error_codes import ERROR_CODES_TEMPLATE
from app.utils.helpers import create_error_response, validate_image_extension


def build_payment_upload_url_response(*, payment_public_id: str, data: dict, s3_client, bucket_name: str):
    file_extension = (data.get("file_extension", "jpg") or "jpg").lower().strip(".")
    sha256_hash = (data.get("sha256") or "").strip().lower()
    mime_type = (data.get("mime_type") or "").strip()[:120]
    file_size = data.get("file_size")

    if not sha256_hash:
        return None, create_error_response("PAY_INVALID_SHA256")
    if len(sha256_hash) != 64 or any(ch not in "0123456789abcdef" for ch in sha256_hash):
        return None, create_error_response("PAY_INVALID_SHA256")

    valid_ext, ext, content_type = validate_image_extension(f"file.{file_extension}")
    if not valid_ext:
        return None, create_error_response("PAY_INVALID_IMAGE_TYPE")

    if file_size is not None:
        try:
            normalized_size = int(file_size)
            max_bytes = max(1, int(PAYMENT_MAX_IMAGE_MB)) * 1024 * 1024
            if normalized_size < 0 or normalized_size > max_bytes:
                return None, create_error_response(
                    "VAL_FILE_TOO_LARGE",
                    details={"max_mb": int(PAYMENT_MAX_IMAGE_MB), "reason": ERROR_CODES_TEMPLATE["VAL_FILE_TOO_LARGE"]["reason"]},
                    max_mb=int(PAYMENT_MAX_IMAGE_MB),
                )
        except Exception:
            return None, create_error_response("VAL_PAYMENT_UPLOAD_FILE_SIZE_INVALID")

    object_key = f"payments/staging/{payment_public_id}/{uuid.uuid4().hex}.{ext}"
    presigned_url = s3_client.generate_presigned_url(
        ClientMethod="put_object",
        Params={
            "Bucket": bucket_name,
            "Key": object_key,
            "ContentType": mime_type or content_type,
        },
        ExpiresIn=max(60, int(PAYMENT_UPLOAD_URL_EXPIRY_SECONDS)),
        HttpMethod="PUT",
    )
    return {
        "upload_url": presigned_url,
        "upload_object_key": object_key,
        "upload_content_type": mime_type or content_type,
        "expires_in_seconds": max(60, int(PAYMENT_UPLOAD_URL_EXPIRY_SECONDS)),
    }, None
