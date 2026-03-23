import base64
import hashlib
import re
from io import BytesIO

from PIL import Image

from app.config import ERROR_CODES, MIN_IMAGE_WIDTH, PAYMENT_MAX_IMAGE_MB, S3_BUCKET_NAME
from app.constants.payment_constants import PAYMENT_FILE_STAGE_PREFIX, UPLOAD_SOURCE_FIELD_IMAGE_BASE64, UPLOAD_SOURCE_FIELD_OBJECT_KEY
from app.utils.helpers import create_error_response, validate_image_extension


def load_verify_upload_image(*, payment_public_id: str, data: dict, s3_client):
    image_base64 = data.get("image_base64")
    upload_object_key = (data.get("upload_object_key") or "").strip()
    file_extension = (data.get("file_extension", "jpg") or "jpg").lower().strip(".")
    sha256_hash = (data.get("sha256") or "").strip().lower()
    mime_type = (data.get("mime_type") or "").strip()[:120]
    original_filename = (data.get("original_filename") or "").strip()[:255]
    client_file_size = data.get("file_size")

    if not image_base64 and not upload_object_key:
        return None, create_error_response("VAL_PAYMENT_VERIFY_UPLOAD_OBJECT_KEY_REQUIRED")
    if not sha256_hash:
        return None, create_error_response("VAL_PAYMENT_VERIFY_SHA256_REQUIRED")
    if not re.match(r"^[a-f0-9]{64}$", sha256_hash):
        return None, create_error_response("PAY_INVALID_SHA256")

    is_valid_ext, ext, content_type = validate_image_extension(f"file.{file_extension}")
    if not is_valid_ext:
        return None, create_error_response("PAY_INVALID_IMAGE_TYPE", {"allowed": ["jpg", "jpeg", "png", "webp"]})

    try:
        if upload_object_key:
            expected_prefix = f"{PAYMENT_FILE_STAGE_PREFIX}/{payment_public_id}/"
            if not upload_object_key.startswith(expected_prefix):
                return None, create_error_response("VAL_PAYMENT_VERIFY_OBJECT_KEY_INVALID")
            obj = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=upload_object_key)
            image_bytes = obj["Body"].read()
        else:
            if "," in image_base64:
                image_base64 = image_base64.split(",")[1]
            image_bytes = base64.b64decode(image_base64)

        max_bytes = max(1, int(PAYMENT_MAX_IMAGE_MB)) * 1024 * 1024
        if len(image_bytes) > max_bytes:
            return None, create_error_response(
                "VAL_FILE_TOO_LARGE",
                details={"max_mb": int(PAYMENT_MAX_IMAGE_MB), "reason": ERROR_CODES["VAL_FILE_TOO_LARGE"]["reason"]},
                max_mb=int(PAYMENT_MAX_IMAGE_MB),
            )
        actual_sha = hashlib.sha256(image_bytes).hexdigest()
        if actual_sha != sha256_hash:
            return None, create_error_response("PAY_INVALID_SHA256")

        image = Image.open(BytesIO(image_bytes))
        if int(getattr(image, "width", 0) or 0) < int(MIN_IMAGE_WIDTH):
            return None, create_error_response("FRAUD_LOW_RESOLUTION")
    except Exception:
        source_field = UPLOAD_SOURCE_FIELD_OBJECT_KEY if upload_object_key else UPLOAD_SOURCE_FIELD_IMAGE_BASE64
        return None, create_error_response("VAL_INVALID_IMAGE_DATA", {"field": source_field})

    return {
        "image_base64": image_base64,
        "upload_object_key": upload_object_key,
        "ext": ext,
        "content_type": content_type,
        "mime_type": mime_type,
        "original_filename": original_filename,
        "client_file_size": client_file_size,
        "sha256_hash": sha256_hash,
        "image_bytes": image_bytes,
        "image": image,
    }, None
