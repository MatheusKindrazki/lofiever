'use client';

interface DateNavigatorProps {
    selectedDate: Date;
    onDateChange: (date: Date) => void;
}

export function DateNavigator({ selectedDate, onDateChange }: DateNavigatorProps) {
    const goToPreviousDay = () => {
        const newDate = new Date(selectedDate);
        newDate.setDate(newDate.getDate() - 1);
        onDateChange(newDate);
    };

    const goToNextDay = () => {
        const newDate = new Date(selectedDate);
        newDate.setDate(newDate.getDate() + 1);
        const now = new Date();
        now.setHours(23, 59, 59, 999); // End of today

        if (newDate <= now) {
            onDateChange(newDate);
        }
    };

    const goToToday = () => {
        onDateChange(new Date());
    };

    const isToday = selectedDate.toDateString() === new Date().toDateString();
    const isFuture = (() => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return selectedDate >= tomorrow;
    })();

    const formatDate = (date: Date) => {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) {
            return 'Hoje';
        } else if (date.toDateString() === yesterday.toDateString()) {
            return 'Ontem';
        } else {
            return date.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'short',
                weekday: 'short'
            });
        }
    };

    return (
        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg border-b border-gray-200 dark:border-gray-600">
            <button
                onClick={goToPreviousDay}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-lofi-600 dark:hover:text-lofi-400 transition-colors rounded hover:bg-gray-100 dark:hover:bg-gray-600"
                aria-label="Dia anterior"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Anterior
            </button>

            <button
                onClick={goToToday}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors ${isToday
                        ? 'bg-lofi-500 text-white'
                        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
            >
                {formatDate(selectedDate)}
            </button>

            <button
                onClick={goToNextDay}
                disabled={isFuture}
                className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors ${isFuture
                        ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed'
                        : 'text-gray-600 dark:text-gray-300 hover:text-lofi-600 dark:hover:text-lofi-400 hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`}
                aria-label="Próximo dia"
            >
                Próximo
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
            </button>
        </div>
    );
}
