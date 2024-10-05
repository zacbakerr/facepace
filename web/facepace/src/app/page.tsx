'use client';

import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/utils/supabase';
import axios from 'axios';
import Image from 'next/image';
import { Instrument_Serif } from 'next/font/google';
import { useRouter } from 'next/navigation';

const instrumentSerif = Instrument_Serif({ subsets: ['latin'], weight: '400' });

export default function Home() {
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [loadingStep, setLoadingStep] = useState<string | null>(null);
  const [step, setStep] = useState<'start' | 'record' | 'photo' | 'analysis'>('start');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    startCamera();
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    document.body.classList.add('full-viewport-height');
    return () => {
      document.body.classList.remove('full-viewport-height');
    };
  }, []);

  useEffect(() => {
    const setVh = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };

    setVh();
    window.addEventListener('resize', setVh);

    return () => window.removeEventListener('resize', setVh);
  }, []);

  const startCamera = async () => {
    try {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: true
      });
      setStream(newStream);
      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
        };
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Flip the image horizontally when capturing
        ctx.scale(-1, 1);
        ctx.drawImage(videoRef.current, -canvas.width, 0, canvas.width, canvas.height);
      }
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      setCapturedImage(imageDataUrl);
    }
  };

  const uploadVideo = async (blob: Blob) => {
    try {
      const { data, error } = await supabase.storage
        .from('photos')
        .upload(`video-${Date.now()}.mp4`, blob);

      if (error) throw error;
      if (!data || !data.path) throw new Error('Video upload successful but no data returned');

      const { data: urlData } = supabase.storage.from('photos').getPublicUrl(data.path);
      if (!urlData || !urlData.publicUrl) throw new Error('Failed to get video public URL');

      setVideoUrl(urlData.publicUrl);
    } catch (error) {
      console.error('Error uploading video:', error);
    }
  };

  const startRecording = () => {
    if (!stream) return;

    const mediaRecorder = new MediaRecorder(stream);
    mediaRecorderRef.current = mediaRecorder;
    const chunks: BlobPart[] = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      uploadVideo(blob);  // Start uploading the video immediately
      setStep('photo');
    };

    mediaRecorder.start();
    setIsRecording(true);
    setCountdown(5);

    const countdownInterval = setInterval(() => {
      setCountdown((prevCount) => {
        if (prevCount <= 1) {
          clearInterval(countdownInterval);
          mediaRecorder.stop();
          setIsRecording(false);
          return 0;
        }
        return prevCount - 1;
      });
    }, 1000);
  };

  const handleUpload = async () => {
    if (!capturedImage || !videoUrl) {
      console.error('Both image and video URL are required');
      return;
    }

    try {
      setLoadingStep('Uploading');

      // Upload image
      const response = await fetch(capturedImage);
      const blob = await response.blob();
      const { data: imageData, error: imageError } = await supabase.storage
        .from('photos')
        .upload(`photo-${Date.now()}.jpg`, blob);

      if (imageError) throw imageError;
      if (!imageData || !imageData.path) throw new Error('Image upload successful but no data returned');

      const { data: imageUrlData } = supabase.storage.from('photos').getPublicUrl(imageData.path);
      if (!imageUrlData || !imageUrlData.publicUrl) throw new Error('Failed to get image public URL');

      const imageUrl = imageUrlData.publicUrl;

      setLoadingStep('Analyzing');

      const analyzeResponse = await axios.post('/api/analyze', { 
        videoUrl,
        imageUrl
      });
      
      if (!analyzeResponse.data || !analyzeResponse.data.result) {
        throw new Error('Analyze API returned unexpected data');
      }

      const { functionalAge, biologicalAgeDifference } = analyzeResponse.data.result;

      router.push(`/results?functionalAge=${functionalAge}&biologicalAgeDifference=${biologicalAgeDifference}&imageUrl=${encodeURIComponent(imageUrl)}`);
    } catch (error) {
      console.error('Error in handleUpload:', error);
    } finally {
      setLoadingStep(null);
    }
  };

  const resetCapture = () => {
    setCapturedImage(null);
    startCamera();
  };

  return (
    <main className="relative h-screen w-full overflow-hidden pt-safe">
      <div className="absolute inset-0">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted 
          className={`object-cover w-full h-full transform scale-x-[-1] ${step !== 'record' || loadingStep ? 'brightness-50 blur-sm' : ''}`}
          // Keep the transform scale-x-[-1] here to mirror the video preview
        />
      </div>

      {capturedImage && step === 'photo' && !loadingStep && (
        <div className="absolute inset-0">
          <Image 
            src={capturedImage} 
            alt="Captured" 
            layout="fill"
            objectFit="cover"
            className="transform scale-x-[-1]" // Add this line to mirror the image
          />
        </div>
      )}

      {step === 'start' ? (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex flex-col items-center justify-center p-4">
          <div className="text-center mb-8">
            <h1 className={`${instrumentSerif.className} text-9xl sm:text-9xl font-bold text-teal-500 leading-tight mb-4`}>
              Face<span className="block -mt-10">Pace</span>
            </h1>
            <p className={`${instrumentSerif.className} text-white text-lg`}>
              Decode your aging, hack longevity.
            </p>
          </div>
        </div>
      ):
      <div className="absolute inset-0 flex flex-col items-center justify-start p-4 pt-safe">
          <div className="text-center mt-8">
            <h1 className={`${instrumentSerif.className} text-4xl sm:text-4xl font-bold text-teal-500 leading-tight mb-4`}>
              Face Pace
            </h1>
          </div>
        </div>
      }

      <div className="absolute bottom-0 left-0 right-0 p-4">
        <div className="w-full max-w-md mx-auto space-y-4">
          {step === 'start' && (
            <button 
              onClick={() => setStep('record')} 
              className="w-full px-6 py-3 bg-teal-500 text-gray-800 rounded-md text-lg font-semibold shadow-lg hover:bg-teal-300 transition duration-300 ease-in-out"
            >
              Get Started
            </button>
          )}

          {step === 'record' && (
            <>
              {!isRecording && (
                <p className="text-white text-center text-lg mb-4">
                  Record yourself counting down from 5 whilst looking at the camera
                </p>
              )}
              <button 
                onClick={startRecording} 
                disabled={isRecording}
                className={`w-20 h-20 rounded-full bg-red-500 flex items-center justify-center mx-auto transition duration-300 ease-in-out ${
                  isRecording ? 'opacity-75 cursor-not-allowed' : 'hover:bg-red-600'
                }`}
              >
                {isRecording ? countdown : ''}
              </button>
            </>
          )}

          {step === 'photo' && !loadingStep && (
            <>
              <p className="text-white text-center text-lg mb-4">
                Now take a photo of yourself smiling
              </p>
              <div className="flex justify-center space-x-4">
                {!capturedImage && (
                  <button 
                    onClick={capturePhoto} 
                    className="w-20 h-20 rounded-full bg-white flex items-center justify-center"
                  >
                    <div className="w-16 h-16 rounded-full bg-gray-200"></div>
                  </button>
                )}
              </div>
              {capturedImage && (
                <div className="flex space-x-2 mt-4">
                  <button 
                    onClick={resetCapture} 
                    className="flex-1 px-6 py-3 bg-red-500 text-white rounded-full text-lg font-semibold shadow-lg hover:bg-red-600 transition duration-300 ease-in-out"
                  >
                    Retake Photo
                  </button>
                  <button 
                    onClick={handleUpload} 
                    className="flex-1 px-6 py-3 bg-blue-500 text-white rounded-full text-lg font-semibold shadow-lg hover:bg-blue-600 transition duration-300 ease-in-out"
                  >
                    Analyze
                  </button>
                </div>
              )}
            </>
          )}
          
          {loadingStep && (
            <div className="text-white text-center">
              <p className="text-lg mb-2">{loadingStep}...</p>
              <div className="w-8 h-8 border-t-2 border-blue-500 border-solid rounded-full animate-spin mx-auto"></div>
            </div>
          )}
        
        </div>
      </div>
    </main>
  );
}