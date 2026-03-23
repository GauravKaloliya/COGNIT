import { useEffect, useRef, useState } from "react";

export function usePaymentUploadState({
  maxUploadBytes,
  maxUploadMb,
  getInvalidTypeMessage,
  getTooLargeMessage,
}) {
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState("");
  const uploadFileRef = useRef(null);
  const fileInputRef = useRef(null);

  const resetSelectedFile = () => {
    if (uploadPreviewUrl) {
      URL.revokeObjectURL(uploadPreviewUrl);
    }
    setUploadFile(null);
    uploadFileRef.current = null;
    setUploadPreviewUrl("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileChange = (event, handlers = {}) => {
    const file = event?.target?.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      resetSelectedFile();
      handlers.onInvalid?.(getInvalidTypeMessage());
      if (event?.target) event.target.value = "";
      return;
    }

    if (file.size > maxUploadBytes) {
      resetSelectedFile();
      handlers.onInvalid?.(getTooLargeMessage(file.size, maxUploadMb));
      if (event?.target) event.target.value = "";
      return;
    }

    if (uploadPreviewUrl) {
      URL.revokeObjectURL(uploadPreviewUrl);
    }

    setUploadFile(file);
    uploadFileRef.current = file;
    setUploadPreviewUrl(URL.createObjectURL(file));
    handlers.onSelected?.(file);
  };

  useEffect(() => {
    return () => {
      if (uploadPreviewUrl) {
        URL.revokeObjectURL(uploadPreviewUrl);
      }
    };
  }, [uploadPreviewUrl]);

  return {
    uploadFile,
    uploadPreviewUrl,
    uploadFileRef,
    fileInputRef,
    handleFileChange,
    clearSelectedFile: resetSelectedFile,
  };
}
