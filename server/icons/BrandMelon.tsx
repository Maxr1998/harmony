export default function IconBrandMelon({
	size = 24,
	color = 'currentColor',
	...props
}) {
	return (
		<svg
			xmlns='http://www.w3.org/2000/svg'
			id='brand-melon'
			width={size}
			height={size}
			viewBox='0 0 24 24'
			fill={color}
			{...props}
		>
			<path
				fillRule='evenodd'
				d='M3.89 15.25A8.0 7.95 0 1 0 19.89 15.25A8.0 7.95 0 1 0 3.89 15.25ZM8.34 15.25A3.55 3.84 0 1 0 15.44 15.25A3.55 3.84 0 1 0 8.34 15.25ZM15.3 3.7A2.95 2.95 0 1 0 21.2 3.7A2.95 2.95 0 1 0 15.3 3.7Z'
			/>
		</svg>
	);
}
