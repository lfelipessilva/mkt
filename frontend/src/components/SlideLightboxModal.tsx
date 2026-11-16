import React, { useEffect, useCallback } from "react";
import type { CarouselSlide } from "../types";
import { AuthImage } from "./AuthImage";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

export function formatSlideBadgeLabel(position: number): string {
  if (position === 1) {
    return "1 (Capa)";
  }
  return `Slide ${position}`;
}

export function resolveNextSlideIndex(currentIndex: number, totalSlides: number): number {
  if (totalSlides <= 0) return 0;
  return Math.min(currentIndex + 1, totalSlides - 1);
}

export function resolvePrevSlideIndex(currentIndex: number, totalSlides: number): number {
  if (totalSlides <= 0) return 0;
  return Math.max(currentIndex - 1, 0);
}

export function canNavigateNext(currentIndex: number, totalSlides: number): boolean {
  return currentIndex < totalSlides - 1;
}

export function canNavigatePrev(currentIndex: number): boolean {
  return currentIndex > 0;
}

export interface SlideLightboxModalProps {
  isOpen: boolean;
  slides: CarouselSlide[];
  initialIndex?: number;
  onClose: () => void;
  title?: string;
}

export function SlideLightboxModal({
  isOpen,
  slides,
  initialIndex = 0,
  onClose,
  title,
}: SlideLightboxModalProps): React.JSX.Element | null {
  const [activeIndex, setActiveIndex] = React.useState(initialIndex);

  useEffect(() => {
    setActiveIndex(initialIndex);
  }, [initialIndex, isOpen]);

  const total = slides.length;
  const currentSlide = slides[activeIndex];

  const handleNext = useCallback(() => {
    if (canNavigateNext(activeIndex, total)) {
      setActiveIndex((prev) => resolveNextSlideIndex(prev, total));
    }
  }, [activeIndex, total]);

  const handlePrev = useCallback(() => {
    if (canNavigatePrev(activeIndex)) {
      setActiveIndex((prev) => resolvePrevSlideIndex(prev, total));
    }
  }, [activeIndex, total]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowRight") {
        handleNext();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleNext, handlePrev, onClose]);

  if (!isOpen || !currentSlide) return null;

  return (
    <div
      className="slide-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Visualização de Slide em Alta Resolução"
      onClick={onClose}
    >
      <div
        className="slide-lightbox-container"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="slide-lightbox-header">
          <div className="slide-lightbox-title-area">
            <span className="slide-lightbox-counter font-semibold text-white">
              Slide {activeIndex + 1} de {total}
            </span>
            {title && <span className="slide-lightbox-topic text-slate-300"> — {title}</span>}
          </div>
          <button
            type="button"
            className="slide-lightbox-btn-close text-slate-300 hover:text-white"
            onClick={onClose}
            aria-label="Fechar preview"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Image Content */}
        <div className="slide-lightbox-body">
          <button
            type="button"
            className="slide-lightbox-nav prev"
            onClick={handlePrev}
            disabled={!canNavigatePrev(activeIndex)}
            aria-label="Slide anterior"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>

          <div className="slide-lightbox-img-wrapper">
            <AuthImage
              storagePath={currentSlide.storage_path}
              alt={`Slide ${currentSlide.position}`}
              className="slide-lightbox-img"
            />
          </div>

          <button
            type="button"
            className="slide-lightbox-nav next"
            onClick={handleNext}
            disabled={!canNavigateNext(activeIndex, total)}
            aria-label="Próximo slide"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
}
