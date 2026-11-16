import React, { useState } from "react";
import type { CarouselRun, CarouselSlide } from "../types";
import { AuthImage } from "./AuthImage";
import { SlideLightboxModal, formatSlideBadgeLabel } from "./SlideLightboxModal";
import { X, ZoomIn } from "lucide-react";
import { orderSlides } from "../tabs/GalleryPage";

export interface CarouselSlidesModalProps {
  isOpen: boolean;
  run: CarouselRun | null;
  onClose: () => void;
}

export function CarouselSlidesModal({
  isOpen,
  run,
  onClose,
}: CarouselSlidesModalProps): React.JSX.Element | null {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (!isOpen || !run) return null;

  const slides: CarouselSlide[] = orderSlides(run.slides || []);

  const handleOpenLightbox = (index: number) => {
    setLightboxIndex(index);
  };

  const handleCloseLightbox = () => {
    setLightboxIndex(null);
  };

  return (
    <>
      <div
        className="modal-backdrop carousel-slides-modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label={`Slides do Carrossel @${run.account_id}`}
        onClick={onClose}
      >
        <div
          className="modal-content carousel-slides-modal-content"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="modal-header">
            <div>
              <h3 className="text-lg font-semibold text-slate-800">
                Todos os Slides ({slides.length})
              </h3>
              <p className="text-sm text-slate-500">
                @{run.account_id} • {run.tema || run.archetype_title}
              </p>
            </div>
            <button
              type="button"
              className="modal-close-btn"
              onClick={onClose}
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="modal-body carousel-slides-grid-body">
            {slides.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                Nenhum slide disponível para este carrossel.
              </div>
            ) : (
              <div className="carousel-slides-grid">
                {slides.map((slide, idx) => (
                  <div
                    key={slide.id || slide.position}
                    className="slide-grid-item group cursor-pointer"
                    onClick={() => handleOpenLightbox(idx)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        handleOpenLightbox(idx);
                      }
                    }}
                    title="Clique para ampliar o slide"
                  >
                    <div className="slide-grid-thumb-wrapper">
                      <AuthImage
                        storagePath={slide.storage_path}
                        alt={`Slide ${slide.position}`}
                        className="slide-grid-thumb-img"
                      />
                      <span className="slide-grid-badge">
                        {formatSlideBadgeLabel(slide.position)}
                      </span>
                      <div className="slide-grid-hover-overlay">
                        <ZoomIn className="w-6 h-6 text-white" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox for enlarged preview */}
      <SlideLightboxModal
        isOpen={lightboxIndex !== null}
        slides={slides}
        initialIndex={lightboxIndex ?? 0}
        onClose={handleCloseLightbox}
        title={run.tema || run.archetype_title}
      />
    </>
  );
}
