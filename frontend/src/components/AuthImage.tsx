import React, { useState, useEffect } from "react";
import { fetchMediaBlob } from "../api";

export interface AuthImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  storagePath?: string;
  src?: string;
  alt?: string;
  fallbackText?: string;
}

export function AuthImage({
  storagePath,
  src,
  alt = "Imagem",
  className = "",
  style,
  fallbackText,
  ...rest
}: AuthImageProps): React.JSX.Element {
  const targetPath = storagePath || src || "";
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    let isCancelled = false;
    let createdUrl: string | null = null;

    if (!targetPath) {
      setLoading(false);
      setError(true);
      return;
    }

    setLoading(true);
    setError(false);

    // If it's already a data URL or blob URL, use directly
    if (targetPath.startsWith("data:") || targetPath.startsWith("blob:")) {
      setBlobUrl(targetPath);
      setLoading(false);
      return;
    }

    // Clean storagePath if full URL or API URL was passed
    let cleanPath = targetPath;
    if (cleanPath.includes("/api/v1/media/file?path=")) {
      const parts = cleanPath.split("/api/v1/media/file?path=");
      cleanPath = decodeURIComponent(parts[1] || "");
    }

    fetchMediaBlob(cleanPath)
      .then((url) => {
        if (isCancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setBlobUrl(url);
        setLoading(false);
      })
      .catch(() => {
        if (!isCancelled) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [targetPath]);

  if (loading) {
    return (
      <div className={`auth-image-placeholder loading ${className}`} style={style}>
        <span className="spinner-sm" />
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div className={`auth-image-placeholder error ${className}`} style={style}>
        <span className="placeholder-icon">📷</span>
        <span className="placeholder-text">{fallbackText || "Erro ao carregar"}</span>
      </div>
    );
  }

  return (
    <img
      src={blobUrl}
      alt={alt}
      className={`auth-image ${className}`}
      style={style}
      {...rest}
    />
  );
}
